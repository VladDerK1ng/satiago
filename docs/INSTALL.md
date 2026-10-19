# Installing Satiago

Satiago runs on **Android** as a native app and on **iPhone, iPad and computers** as an installable
web app. Both versions are the same app with the same features, apart from the differences listed
below. Everything you log stays on your device.

| Your device | What to install |
|---|---|
| iPhone or iPad | The web app from Safari ([steps below](#iphone-and-ipad)) |
| Android phone | The Android app (APK), or the web app from Chrome |
| Computer | The web app in Chrome, Edge or Safari |

Web app address: **https://vladderk1ng.github.io/satiago/**

---

## iPhone and iPad

You need iOS or iPadOS 16.4 or newer. No App Store, no account, nothing to pay.

1. Open **Safari** and go to **https://vladderk1ng.github.io/satiago/**
   (open it in Safari itself, not inside another app such as Instagram or WhatsApp).
2. Tap the **Share** button, the square with an arrow pointing up. It is at the bottom of the
   screen on iPhone and at the top on iPad.
3. Scroll down and tap **Add to Home Screen**.
4. Keep the name **Satiago** and tap **Add**.
5. From now on, open Satiago from its **home screen icon**. It opens full screen, like any other
   app, and works offline.

The first time you scan a barcode, iOS asks for camera access. Tap **Allow**. If you said no by
mistake, go to **Settings → Apps → Safari → Camera** and choose **Allow**.

### Keep your data safe on iPhone

Your data lives inside the Satiago home screen app on that iPhone.

- **Deleting the home screen icon deletes your data.** Export a backup first.
- Make a backup now and then: **More → Data → Export backup**, then save the file to **Files** or
  **iCloud Drive**.
- To move to a new phone, restore that file there with **More → Data → Restore from file**. This
  also works between Android and iPhone.

### Updates

The web app updates itself. When a new version is out, it loads the next time you open Satiago
with an internet connection.

---

## Android

**Option 1: the Android app.** When a release is published, download the latest `.apk` from the
[Releases page](https://github.com/VladDerK1ng/satiago/releases) and open it. Android asks you to
allow installs from your browser or file manager the first time.

**Option 2: build it yourself.** See [Build from source](../README.md#build-from-source).

**Option 3: the web app.** Open **https://vladderk1ng.github.io/satiago/** in Chrome, tap the
menu (⋮) and choose **Install app** or **Add to Home screen**.

---

## What is different between the versions

| Feature | Android app | Web app (iPhone, iPad, computer) |
|---|---|---|
| Food logging, coaching, check-ins, insights, habits | Yes | Yes |
| Built-in food database (300+ foods) | Yes | Yes |
| Barcode scanning with the camera | Yes (Google ML Kit) | Yes (on-device decoder) |
| Barcode lookup on Open Food Facts | Yes | Yes |
| Searching Open Food Facts **by name** | Yes | No (their service blocks requests from websites). Use the barcode or the built-in foods |
| Health Connect (weight, steps, nutrition sync) | Yes | No. Apple Health is not available to web apps |
| Reminder notifications | Yes | No. iOS does not let web apps schedule reminders without a server |
| AI Assist with your own key | Yes, key in the Android Keystore | Yes, key in the browser's storage on that device |
| Import (MacroFactor, CSV) and export | Yes | Yes |
| Works offline | Yes | Yes, after the first visit |

---

## Troubleshooting

- **No "Add to Home Screen" on iPhone.** Make sure the page is open in Safari, not in an in-app
  browser. Tap the address bar's share button, or the **⋯** menu, then **Share**.
- **The camera shows a black screen.** Close other apps that use the camera, then reopen
  Satiago. Check camera permission as described above.
- **Online search says it only works in the Android app.** This is expected on the web version.
  Scan the product's barcode instead, or type the barcode number.
- **Something else.** Please [open an issue](https://github.com/VladDerK1ng/satiago/issues) and
  describe your device and what happened. Never include your backup file or personal data.
