import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FoodSheet } from '../components/FoodSheet';
import { FoodRow } from '../components/nutrition';
import { Page, Seg } from '../components/ui';
import type { Food } from '../domain/types';
import { isoDate } from '../domain/util';
import { t } from '../i18n';
import { haptic } from '../platform/haptics';
import { useFoodLookup, useFoods, useStore } from '../store';
import { EmptyState, type Scene } from '../ui/Illustration';
import { motionTokens, stagger } from '../ui/motion';
import { toast } from '../ui/snackbar';
import '../styles/food.css';

type Tab = 'custom' | 'recipes' | 'favorites';

export default function Library() {
  const [tab, setTab] = useState<Tab>('custom');
  const foods = useFoods();
  const favorites = useStore((s) => s.favorites);
  const toggleFavorite = useStore((s) => s.toggleFavorite);
  const addEntries = useStore((s) => s.addEntries);
  const lookup = useFoodLookup();
  const nav = useNavigate();
  const [logFood, setLogFood] = useState<Food>();
  const [logOpen, setLogOpen] = useState(false);
  const [logMinute, setLogMinute] = useState(0);
  const list: Food[] =
    tab === 'custom'
      ? foods.filter((f) => f.source === 'custom' || f.source === 'openfoodfacts')
      : tab === 'recipes'
        ? foods.filter((f) => f.source === 'recipe')
        : favorites.map(lookup).filter((f): f is Food => !!f);

  const toggleFav = (f: Food) => {
    const was = favorites.includes(f.id);
    haptic('select');
    toggleFavorite(f.id);
    toast(was ? t('food.lib.unfavorited', { name: f.name }) : t('food.lib.favorited', { name: f.name }), {
      label: t('common.undo'),
      run: () => useStore.getState().toggleFavorite(f.id),
    });
  };
  const open = (f: Food) => {
    if (tab === 'favorites') {
      const d = new Date();
      setLogMinute(d.getHours() * 60 + d.getMinutes());
      setLogFood(f);
      setLogOpen(true);
    } else nav(f.source === 'recipe' ? `/recipes/${f.id}` : `/foods/${f.id}`);
  };

  const empty: Record<Tab, { scene: Scene; title: string; sub: string; action: string; go: string }> = {
    custom: { scene: 'empty-log', title: t('food.lib.emptyCustom'), sub: t('food.lib.emptyCustomSub'), action: t('food.add.customFood'), go: '/foods/new' },
    recipes: { scene: 'empty-recipes', title: t('food.lib.emptyRecipes'), sub: t('food.lib.emptyRecipesSub'), action: t('food.add.recipe'), go: '/recipes/new' },
    favorites: { scene: 'empty-favorites', title: t('food.lib.emptyFavorites'), sub: t('food.lib.emptyFavoritesSub'), action: t('log.addFood'), go: '/add' },
  };
  const e = empty[tab];

  return (
    <Page title={t('log.myFoods')} back>
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          { value: 'custom', label: t('food.lib.tabCustom') },
          { value: 'recipes', label: t('food.lib.tabRecipes') },
          { value: 'favorites', label: t('food.lib.tabFavorites') },
        ]}
      />
      <div className="row" style={{ margin: '10px 0', gap: 6 }}>
        <button className="btn sm primary" onClick={() => nav('/foods/new')}>
          {t('food.add.customFood')}
        </button>
        <button className="btn sm" onClick={() => nav('/recipes/new')}>
          {t('food.add.recipe')}
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {list.length === 0 ? (
          <motion.div key={`empty-${tab}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={motionTokens.base}>
            <EmptyState scene={e.scene} title={e.title}>
              <p className="muted small" style={{ margin: 0 }}>
                {e.sub}
              </p>
              <button className="btn primary" style={{ marginTop: 8 }} onClick={() => nav(e.go)}>
                {e.action}
              </button>
            </EmptyState>
          </motion.div>
        ) : (
          <motion.div key={`list-${tab}`} className="card list tight" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={motionTokens.base}>
            <AnimatePresence initial={false}>
              {list.map((f, i) => {
                const fav = favorites.includes(f.id);
                return (
                  <motion.div
                    key={f.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { ...motionTokens.list, delay: stagger(i) } }}
                    exit={{ opacity: 0, height: 0, transition: motionTokens.base }}
                  >
                    <FoodRow
                      f={f}
                      onClick={() => open(f)}
                      right={
                        <button
                          className={`icon-btn touch fav-toggle${fav ? ' on' : ''}`}
                          aria-pressed={fav}
                          aria-label={fav ? t('food.lib.unfavorite', { name: f.name }) : t('food.lib.favorite', { name: f.name })}
                          onClick={() => toggleFav(f)}
                        >
                          <motion.span key={String(fav)} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={motionTokens.sheet} aria-hidden>
                            {fav ? '★' : '☆'}
                          </motion.span>
                        </button>
                      }
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
      <FoodSheet
        open={logOpen}
        food={logFood}
        date={isoDate()}
        minute={logMinute}
        onClose={() => setLogOpen(false)}
        onAdd={(entry) => {
          addEntries([entry]);
          haptic('add');
          toast(t('log.added', { name: entry.name }));
        }}
      />
    </Page>
  );
}
