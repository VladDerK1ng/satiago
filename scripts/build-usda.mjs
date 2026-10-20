// Builds public/data/usda-foods.json, the offline food database, from USDA FoodData Central
// downloads (public domain, CC0 1.0): Foundation Foods, SR Legacy and FNDDS (survey foods).
//
//   node --max-old-space-size=4096 scripts/build-usda.mjs <foundation.json> <sr_legacy.json> <survey.json> [out.json]
//
// The JSON files come from https://fdc.nal.usda.gov/download-datasets (the "JSON" zips).
// Values stay per 100 g as published. Each food keeps the nutrients the app tracks, a category and
// emoji the app uses, and up to six household servings.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [foundationPath, srPath, surveyPath, outPath = 'public/data/usda-foods.json'] = process.argv.slice(2);
if (!surveyPath) {
  console.error('usage: build-usda.mjs <foundation.json> <sr_legacy.json> <survey.json> [out.json]');
  process.exit(1);
}

// Same order as NUTRIENT_KEYS in src/domain/types.ts. Each key lists FDC nutrient numbers in order of
// preference; units already match the app (g, mg, µg; vitamin A as RAE, folate as DFE, D in µg).
const NUTRIENTS = [
  ['kcal', '208', '958', '957'],
  ['protein', '203'],
  ['carbs', '205', '205.2'],
  ['fat', '204', '298'],
  ['fiber', '291', '293'],
  ['sugar', '269', '269.3'],
  ['addedSugar', '539'],
  ['satFat', '606'],
  ['monoFat', '645'],
  ['polyFat', '646'],
  ['transFat', '605'],
  ['cholesterol', '601'],
  ['sodium', '307'],
  ['potassium', '306'],
  ['calcium', '301'],
  ['iron', '303'],
  ['magnesium', '304'],
  ['zinc', '309'],
  ['phosphorus', '305'],
  ['selenium', '317'],
  ['vitaminA', '320'],
  ['vitaminC', '401'],
  ['vitaminD', '328'],
  ['vitaminE', '323'],
  ['vitaminK', '430'],
  ['thiamin', '404'],
  ['riboflavin', '405'],
  ['niacin', '406'],
  ['vitaminB6', '415'],
  ['folate', '435', '417'],
  ['vitaminB12', '418'],
  ['caffeine', '262'],
  ['alcohol', '221'],
];

// SR Legacy and Foundation food groups.
const FOOD_GROUPS = {
  'Vegetables and Vegetable Products': 'Vegetables',
  'Fruits and Fruit Juices': (n) => (/\bjuice|nectar\b/.test(n) ? 'Beverages' : 'Fruits'),
  'Dairy and Egg Products': 'Dairy & Eggs',
  'Cereal Grains and Pasta': 'Grains',
  'Breakfast Cereals': 'Grains',
  'Baked Products': (n) => (/cookie|cake|\bpie\b|pastr|doughnut|brownie|danish|sweet roll|eclair|strudel/.test(n) ? 'Snacks & Sweets' : 'Grains'),
  'Legumes and Legume Products': (n) => (/tofu|tempeh|meatless|vegetarian|veggie|soy protein|seitan/.test(n) ? 'Plant Protein' : 'Legumes'),
  'Finfish and Shellfish Products': 'Seafood',
  'Nut and Seed Products': 'Nuts & Seeds',
  'Beef Products': 'Meat',
  'Poultry Products': 'Meat',
  'Pork Products': 'Meat',
  'Lamb, Veal, and Game Products': 'Meat',
  'Sausages and Luncheon Meats': 'Meat',
  'Fats and Oils': (n) => (/dressing|mayonnaise|sandwich spread/.test(n) ? 'Condiments' : 'Fats & Oils'),
  Beverages: 'Beverages',
  'Spices and Herbs': 'Condiments',
  'Soups, Sauces, and Gravies': (n) => (/^soup|\bsoup\b|broth|stew|chowder/.test(n) ? 'Prepared' : 'Condiments'),
  Sweets: 'Snacks & Sweets',
  Snacks: 'Snacks & Sweets',
  'Fast Foods': 'Prepared',
  'Restaurant Foods': 'Prepared',
  'Meals, Entrees, and Side Dishes': 'Prepared',
  'American Indian/Alaska Native Foods': 'Prepared',
  'Baby Foods': null,
};

// FNDDS foods carry a WWEIA category instead. First match wins; null drops the food.
const WWEIA = [
  [/^baby|^formula|human milk/i, null],
  [/sandwich|burgers|pizza|burritos|nachos|mixed dishes|mexican|stir-fry|fried rice|egg rolls|soups|macaroni and cheese|vegetable dishes|legume dishes|coleslaw|mashed potatoes|french fries|fried vegetables|chicken patties/i, 'Prepared'],
  [/water|soft drinks|diet drinks|sport and energy|fruit drinks|juice|coffee|^tea$|beer|wine|liquor|smoothies|nutritional beverages|plant-based milk/i, 'Beverages'],
  [/milk|cheese|yogurt|cream|eggs and omelets/i, 'Dairy & Eggs'],
  [/ice cream|frozen dairy|pudding|gelatins|cakes|cookies|doughnuts|candy|cereal bars|nutrition bars|chips|pretzels|popcorn|crackers/i, 'Snacks & Sweets'],
  [/breads|rolls|bagels|tortillas|biscuits|pancakes|cereal|oatmeal|grits|^rice$|pasta, noodles|turnovers/i, 'Grains'],
  [/beef|pork|lamb|chicken|turkey|poultry|meats|sausages|frankfurters|bacon/i, 'Meat'],
  [/fish|shellfish/i, 'Seafood'],
  [/nuts and seeds/i, 'Nuts & Seeds'],
  [/beans, peas, legumes/i, 'Legumes'],
  [/soy and meat-alternative/i, 'Plant Protein'],
  [/fruit|apples|bananas|berries|citrus|grapes|melons|peaches|pears|pineapple|mango|strawberries/i, 'Fruits'],
  [/vegetable|potato|carrots|broccoli|spinach|corn|string beans|tomatoes|onions|lettuce|cabbage|olives/i, 'Vegetables'],
  [/animal fats|margarine|vegetable oils/i, 'Fats & Oils'],
  [/condiments|sauces|gravies|dips|mayonnaise|jams|sugars|sugar substitutes/i, 'Condiments'],
  [/protein and nutritional powders/i, 'Supplements'],
];

const CATEGORY_ICON = {
  Vegetables: '🥦', Fruits: '🍎', 'Dairy & Eggs': '🥛', Grains: '🌾', Legumes: '🫘', Seafood: '🐟', 'Nuts & Seeds': '🥜', Meat: '🥩',
  'Fats & Oils': '🫒', Beverages: '🥤', Condiments: '🧂', 'Snacks & Sweets': '🍬', Prepared: '🍽️', 'Plant Protein': '🫘', Supplements: '💊',
};

// Name keywords to emoji. Dishes and drinks come before their ingredients ("Pizza, cheese" is a pizza).
const ICONS = [
  [/pizza/, '🍕'], [/burger/, '🍔'], [/sandwich|\bsub\b|wrap\b/, '🥪'], [/taco|burrito|nacho|quesadilla|enchilada|tamale/, '🌮'], [/sushi/, '🍣'],
  [/ramen|noodle soup|pho\b/, '🍜'], [/soup|broth|stew|chowder|chili con/, '🍲'], [/salad\b/, '🥗'], [/french fr|\bfries\b/, '🍟'], [/hot dog|frankfurter/, '🌭'],
  [/smoothie|shake\b|soda|soft drink|cola\b|carbonated|energy drink|sport drink|sports drink/, '🥤'], [/juice|nectar/, '🧃'], [/coffee|espresso|latte|cappuccino|mocha/, '☕'],
  [/\btea\b/, '🍵'], [/beer|\bale\b|lager/, '🍺'], [/wine/, '🍷'], [/whiskey|vodka|\brum\b|\bgin\b|liquor|liqueur|cocktail|margarita|martini|daiquiri/, '🍸'], [/^water|, water\b|bottled water|tap water/, '💧'],
  [/^spices?\b|seasoning|^salt\b|cinnamon|oregano|basil|thyme|parsley|cumin|paprika/, '🌿'],
  [/chocolate milk|strawberry milk|flavored milk|milk, chocolate/, '🥛'], [/ice cream|frozen yogurt|sherbet|gelato|sorbet/, '🍨'], [/cake|cupcake|cheesecake/, '🍰'], [/\bpie\b|pastry|danish|turnover|strudel/, '🥧'], [/cookie|brownie/, '🍪'], [/doughnut|donut/, '🍩'],
  [/chocolate|candy|candies|cocoa|fudge/, '🍫'], [/popcorn/, '🍿'], [/pretzel/, '🥨'], [/chips|crisps|cracker/, '🍘'], [/pancake|waffle|french toast/, '🥞'],
  [/honey|syrup|\bjam\b|jelly|preserves|marmalade|sugar/, '🍯'], [/peanut/, '🥜'], [/almond|walnut|cashew|pecan|pistachio|hazelnut|macadamia|chestnut|\bnuts?\b/, '🌰'], [/seed/, '🌱'],
  [/\beggs?\b|omelet|egg white|egg yolk/, '🥚'], [/cheese/, '🧀'], [/\bmilk\b|yogurt|kefir|cream\b/, '🥛'], [/\bbutter\b|margarine|ghee/, '🧈'], [/\boils?\b|olive|lard|shortening/, '🫒'],
  [/bacon/, '🥓'], [/sausage|bratwurst|salami|pepperoni|bologna|kielbasa|chorizo/, '🌭'], [/turkey/, '🦃'], [/chicken|duck|goose|poultry|cornish|quail|pheasant/, '🍗'],
  [/beef|steak|veal|lamb|mutton|pork|\bham\b|venison|bison|goat|elk|rabbit|liver|\bmeat\b/, '🥩'],
  [/shrimp|prawn|lobster|crab|crayfish|crawfish/, '🦐'], [/oyster|clam|mussel|scallop|squid|octopus|calamari/, '🦪'],
  [/fish|salmon|tuna|\bcod\b|trout|tilapia|sardine|anchov|mackerel|herring|halibut|pollock|haddock|catfish|\bbass\b|snapper|flounder|sole\b|perch|pike/, '🐟'],
  [/watermelon/, '🍉'], [/melon|cantaloupe/, '🍈'], [/pineapple/, '🍍'], [/grapefruit|orange|tangerine|mandarin|clementine/, '🍊'], [/lemon|lime\b/, '🍋'], [/apple/, '🍎'],
  [/banana|plantain/, '🍌'], [/grape|raisin/, '🍇'], [/strawberr/, '🍓'], [/blueberr|blackberr|elderberr|huckleberr/, '🫐'], [/cherr/, '🍒'], [/peach|nectarine|apricot/, '🍑'],
  [/\bpears?\b/, '🍐'], [/mango/, '🥭'], [/coconut/, '🥥'], [/kiwi/, '🥝'], [/avocado|guacamole/, '🥑'], [/tomato|ketchup|catsup/, '🍅'], [/sweet potato|\byams?\b/, '🍠'],
  [/potato/, '🥔'], [/carrot/, '🥕'], [/\bcorn\b|cornmeal|hominy|polenta/, '🌽'], [/broccoli|cauliflower/, '🥦'], [/lettuce|spinach|kale|greens|cabbage|chard|arugula|collard|bok choy/, '🥬'],
  [/cucumber|pickle|zucchini/, '🥒'], [/peppers?, (sweet|bell)|bell pepper/, '🫑'], [/jalape|chili|chile|peppers?, hot|hot pepper/, '🌶️'], [/onion|leek|shallot|scallion/, '🧅'],
  [/garlic/, '🧄'], [/mushroom/, '🍄'], [/eggplant/, '🍆'], [/pumpkin|squash/, '🎃'], [/\bpeas?\b|green beans|snap beans|edamame/, '🫛'],
  [/tofu|tempeh|soy|bean|lentil|chickpea|hummus|garbanzo/, '🫘'], [/rice\b/, '🍚'], [/pasta|spaghetti|macaroni|noodle|lasagna|ravioli|linguine|fettuccine/, '🍝'],
  [/tortilla|pita|naan|flatbread/, '🫓'], [/cereal|oat|granola|muesli|porridge|grits|bran\b/, '🥣'], [/bread|bagel|\brolls?\b|\bbuns?\b|toast|biscuit|muffin|croissant|english muffin/, '🍞'],
  [/wheat|barley|quinoa|flour|rye|millet|couscous|bulgur|buckwheat|amaranth/, '🌾'],
  [/sauce|gravy|dressing|mustard|mayonnaise|salsa|vinegar|relish/, '🥫'], [/powder|supplement|protein shake/, '💊'],
];

// Dry, undiluted or dense forms of a drink are weighed, not poured; prepared drinks are liquids again.
const NOT_POURED = /powder|\bdry\b|dried|instant|grounds|leaves|beans|whipped|paste|condensed|evaporated|undiluted|frozen concentrate|concentrated|(?<!from )concentrate\b/;
const PREPARED = /prepared with|diluted with|reconstituted|brewed/;

const icon = (name, category) => {
  const n = name.toLowerCase();
  const head = n.split(',')[0];
  for (const text of [head, n]) for (const [re, e] of ICONS) if (re.test(text)) return e;
  return CATEGORY_ICON[category];
};

const sig = (v) => Number(v.toPrecision(3));
const FRACTIONS = { 0.25: '1/4', 0.33: '1/3', 0.5: '1/2', 0.67: '2/3', 0.75: '3/4', 1.5: '1 1/2' };
const amountText = (a) => FRACTIONS[Math.round(a * 100) / 100] ?? String(sig(a));

function servingsOf(food, dataset) {
  const out = [];
  const seen = new Set();
  const portions = [...(food.foodPortions ?? [])].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
  for (const p of portions) {
    const grams = p.gramWeight;
    if (!grams || grams <= 0) continue;
    let label;
    if (dataset === 'survey') {
      label = p.portionDescription?.trim();
      if (!label || /quantity not specified|guideline amount/i.test(label)) continue;
    } else {
      const unit = p.measureUnit?.name;
      if (unit === 'RACC') continue;
      const amount = p.amount ?? p.value ?? 1;
      const parts = [amountText(amount)];
      if (unit && unit !== 'undetermined') parts.push(p.measureUnit.abbreviation && p.measureUnit.abbreviation !== 'undetermined' ? p.measureUnit.abbreviation : unit);
      if (p.modifier && !/^\d+$/.test(p.modifier)) parts.push(p.modifier.trim());
      label = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (label === amountText(amount)) continue;
    }
    label = label.replace(/\s+/g, ' ');
    if (seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push([label, sig(grams)]);
    if (out.length === 6) break;
  }
  return out;
}

function nutrientsOf(food) {
  const byNumber = new Map();
  for (const n of food.foodNutrients ?? []) {
    const num = n.nutrient?.number;
    if (num && typeof n.amount === 'number' && Number.isFinite(n.amount) && !byNumber.has(num)) byNumber.set(num, n.amount);
  }
  return NUTRIENTS.map(([, ...numbers]) => {
    for (const num of numbers) if (byNumber.has(num)) return Math.max(0, sig(byNumber.get(num)));
    return null;
  });
}

function categoryOf(food, dataset) {
  const n = food.description.toLowerCase();
  if (dataset === 'survey') {
    const c = food.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? '';
    for (const [re, cat] of WWEIA) if (re.test(c)) return cat;
    return 'Prepared';
  }
  const group = food.foodCategory?.description;
  if (!(group in FOOD_GROUPS)) return 'Prepared';
  const m = FOOD_GROUPS[group];
  return typeof m === 'function' ? m(n) : m;
}

const isLiquid = (name, category) => {
  const n = name.toLowerCase();
  if (NOT_POURED.test(n) && !(PREPARED.test(n) && !/undiluted/.test(n))) return false;
  if (category === 'Beverages') return true;
  return category === 'Dairy & Eggs' && /^(milk|buttermilk|beverage|kefir)\b|^milk,|\bmilk, (whole|reduced|low|non|fat|skim|nfs|2%|1%)|(soy|almond|oat|rice|coconut) milk\b/.test(n) && !/cheese|yogurt|pudding/.test(n);
};

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

const foods = [];
const names = new Set();
const stats = { read: 0, dropped: { noMacros: 0, baby: 0, duplicate: 0, empty: 0 }, energyOff: 0 };
for (const [dataset, path] of [['foundation', foundationPath], ['sr', srPath], ['survey', surveyPath]]) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const list = Object.values(json)[0];
  for (const f of list) {
    if (!f?.description || !f.fdcId) {
      stats.dropped.empty++;
      continue;
    }
    stats.read++;
    const category = categoryOf(f, dataset);
    if (category === null) {
      stats.dropped.baby++;
      continue;
    }
    const nutrients = nutrientsOf(f);
    const [kcal, protein, carbs, fat] = nutrients;
    if ([kcal, protein, carbs, fat].some((v) => v === null)) {
      stats.dropped.noMacros++;
      continue;
    }
    const key = norm(f.description);
    if (names.has(key)) {
      stats.dropped.duplicate++;
      continue;
    }
    names.add(key);
    const atwater = protein * 4 + carbs * 4 + fat * 9 + (nutrients[NUTRIENTS.length - 1] ?? 0) * 7;
    if (Math.abs(atwater - kcal) > Math.max(20, kcal * 0.25)) stats.energyOff++;
    while (nutrients.length && nutrients[nutrients.length - 1] === null) nutrients.pop();
    const name = f.description.trim().replace(/\s+/g, ' ');
    foods.push([f.fdcId, name, category, icon(name, category), isLiquid(name, category) ? 1 : 0, nutrients, servingsOf(f, dataset)]);
  }
}

const out = {
  source: 'USDA FoodData Central (https://fdc.nal.usda.gov), public domain under CC0 1.0',
  datasets: ['Foundation Foods 2026-04', 'SR Legacy 2018-04', 'FNDDS 2021-2023 (released 2024-10)'],
  // Row layout: [fdcId, name, category, emoji, liquid, nutrients per 100 g in `keys` order (null = not measured), [[serving, grams]]]
  keys: NUTRIENTS.map(([k]) => k),
  foods,
};
mkdirSync(dirname(outPath), { recursive: true });
// One food per line keeps diffs between dataset releases readable.
const body = JSON.stringify({ ...out, foods: [] }).replace('"foods":[]', `"foods":[\n${foods.map((f) => JSON.stringify(f)).join(',\n')}\n]`);
writeFileSync(outPath, body + '\n');
const byCategory = {};
for (const f of foods) byCategory[f[2]] = (byCategory[f[2]] ?? 0) + 1;
console.log(JSON.stringify({ ...stats, kept: foods.length, liquids: foods.filter((f) => f[4]).length, noServings: foods.filter((f) => !f[6].length).length, bytes: Buffer.byteLength(body), byCategory }));
