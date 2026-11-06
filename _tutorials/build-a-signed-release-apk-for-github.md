---
title: "Build a signed release APK and publish it on GitHub"
description: Turn your Android Studio project into a signed APK that anyone can download from your GitHub Releases page. Create a signing key, keep its passwords out of git, build and check the APK, then let GitHub Actions do it for you on every version tag.
tags: [android, gradle, github, github-actions, apk]
related: []
tested_on: "Written for Android Gradle Plugin 8.x with Kotlin DSL (build.gradle.kts) or Groovy (build.gradle), Android Studio on macOS, and GitHub Actions on ubuntu-latest"
time: "45 minutes the first time, 2 minutes per release after that"
updated: 2026-11-05
---

When you press the green **Run** button in Android Studio, you get a **debug** build. It's fine for your own phone, but it's not something to hand to other people: it's slower, it's bigger, and it's signed with a throwaway key that lives only on your computer.

A **release APK** is the version you publish. This tutorial takes you from "my app runs in Android Studio" to "anyone can download `myapp-v1.0.0.apk` from my GitHub page and install it", and then automates it so the next release is one `git push`.

Here is the whole journey:

```text
  Your project           ./gradlew assembleRelease          GitHub
  ────────────           ─────────────────────────          ──────
  app code      ─┐
  version 1.0.0 ─┼──►  build  ──►  sign with  ──►  app-release.apk  ──►  Releases page
  signing key   ─┘                 YOUR key                              v1.0.0
  (kept secret)                                                          └─ myapp-v1.0.0.apk
```

You'll do it by hand first (steps 1 to 8), so you understand every piece, and then hand the same job to GitHub Actions (steps 9 to 11).

## Why an APK has to be signed
{: .no-step}

Every Android app must carry a **digital signature** before a phone will install it. Think of it as a **wax seal on a letter**: the seal says who sent it, and if anyone tampers with the contents, the seal breaks.

The seal is made with a **signing key**, which is a pair of matching keys:

- a **private key** that only you have, used to make the seal, and
- a **certificate** (the public half) that is copied into every APK, so phones can check the seal.

The key lives inside a password-protected file called a **keystore** (a `.jks` file). One keystore can hold several keys, and each key has a name called its **alias**.

The part that matters most for you: **Android only accepts an update if it's signed with the same key as the version already installed.** When someone installs version 1.0 of your app and you later publish 1.1, the phone compares the two seals. Same key, the update installs and their data stays. Different key, the phone refuses with "App not installed".

```text
  Phone has v1.0 signed with KEY A
     │
     ├── you publish v1.1 signed with KEY A  ──►  ✅ updates, user data kept
     │
     └── you publish v1.1 signed with KEY B  ──►  ❌ "App not installed"
                                                  (user must uninstall first,
                                                   losing their app data)
```

So the signing key is not a build detail you can regenerate later. **It is your app's identity, for as long as the app exists.** That's why this tutorial spends a whole step on backing it up and another on keeping it out of git.

{% include callout.html type="note" title="APK or AAB?" text="An **APK** is a file a phone can install directly. An **AAB** (Android App Bundle) is a format only the Google Play Store accepts and turns into APKs for each phone. For downloads from GitHub, you want an **APK**. If you go to Play later, you can build an AAB with `./gradlew bundleRelease` from the same setup." %}

## What you need
{: .no-step}

- An Android project that already builds and runs in **Android Studio**.
- The project in a **GitHub repository** that you can push to.
- **Git** on your Mac, and ideally the **GitHub CLI** (`gh`). Install it with `brew install gh`, then run `gh auth login` once. You can do everything in the GitHub website instead; both ways are shown.
- A **terminal** opened in your project's root folder: the one that contains `gradlew`, `settings.gradle.kts` (or `settings.gradle`) and the `app` folder.

In the steps below, the app module is called `app` and the app is called `myapp`. Swap in your own names where you see them.

{% include callout.html type="tip" title="Use Android Studio's built-in terminal" text="Android Studio ships its own Java, and its **Terminal** tab (bottom of the window) is already set up to use it. If you use the Mac's Terminal app instead and `java` or `keytool` is not found, see Troubleshooting at the end." %}

## Set the version number

Every release needs two numbers. They live in `app/build.gradle.kts` (or `app/build.gradle`), inside `defaultConfig`:

{% include file.html name="app/build.gradle.kts" %}

```kotlin
android {
    defaultConfig {
        applicationId = "com.example.myapp"
        // ...
        versionCode = 1
        versionName = "1.0.0"
    }
}
```

They do different jobs:

| Field | Who reads it | Rule |
| --- | --- | --- |
| `versionCode` | The phone | A whole number. **Must go up with every release** (1, 2, 3...). Android refuses to install an "update" whose number is not higher than the installed one. |
| `versionName` | People | Any text. Shown in the phone's app info and used for your release name. `1.0.0`, `1.1.0`, `2.0.0`... |

A common habit for `versionName` is **major.minor.patch**: bump the last number for bug fixes, the middle one for new features, the first one for big changes.

{% include callout.html type="warning" title="Don't change the applicationId" text="`applicationId` (for example `com.example.myapp`) is the app's permanent name on the phone. If it changes, Android sees a completely different app, and the old one stays installed next to it. Pick it once and keep it." %}

## Create your signing key

You make the keystore with **`keytool`**, a small program that comes with Java. First make a folder for it **outside your project**, so it can never be committed by accident:

```bash
mkdir -p ~/android-keys
```

Then create the keystore:

```bash
keytool -genkeypair -v \
  -keystore ~/android-keys/myapp-release.jks \
  -alias myapp \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

What each part means:

| Part | Meaning |
| --- | --- |
| `-genkeypair` | Make a new private key and its certificate. |
| `-keystore ~/android-keys/myapp-release.jks` | Where to save the keystore file. |
| `-alias myapp` | The name of the key inside the keystore. You'll need it later. |
| `-keyalg RSA -keysize 2048` | The kind and strength of key. These are the standard values for Android. |
| `-validity 10000` | Days until the certificate expires: about 27 years. Android asks for at least 25 years, because an expired key can't sign updates. |

`keytool` then asks you some questions:

```text
Enter keystore password:          ← choose a strong password, write it down
Re-enter new password:
What is your first and last name?
  [Unknown]:  Your Name
What is the name of your organizational unit?
  [Unknown]:                      ← Enter to skip
What is the name of your organization?
  [Unknown]:                      ← Enter to skip
What is the name of your City or Locality?
  [Unknown]:                      ← Enter to skip, or your city
What is the name of your State or Province?
  [Unknown]:
What is the two-letter country code for this unit?
  [Unknown]:  BD                  ← your two-letter country code
Is CN=Your Name, OU=Unknown, ... correct?
  [no]:  yes
```

The name and place questions end up inside the certificate, where anyone who inspects your APK can see them. They don't have to be your real address; a name and a country code are enough.

When it finishes, you have one file: `~/android-keys/myapp-release.jks`.

{% include callout.html type="note" title="Only one password" text="Modern Java saves keystores in the PKCS12 format, where the keystore password and the key password are the same thing. `keytool` doesn't ask for a separate key password. Later, when Gradle asks for both, give it the same password twice." %}

{% include callout.html type="tip" title="Prefer clicking?" text="Android Studio can make the same file: **Build → Generate Signed App Bundle or APK → APK → Next → Create new...**. Fill in the path, password, alias and your name, click **OK**, then **cancel** the wizard. You only want the keystore; the rest of this tutorial builds the APK from the command line, which is what GitHub Actions will do too." %}

## Back up the key, today

Remember the wax seal: if this file or its password is lost, **you can never publish another update to the people who installed your app.** They'd have to uninstall it and install a "new" app. If someone else gets the file and the password, they can publish updates that look like they came from you.

Do these now, while it's fresh:

1. Save the **password** and the **alias** (`myapp`) in your password manager.
2. Copy `myapp-release.jks` somewhere safe that is **not** your laptop and **not** a git repository: an encrypted USB stick, or your password manager if it stores files (1Password and Bitwarden both do).
3. Check you can read it back from the backup:

```bash
keytool -list -v -keystore ~/android-keys/myapp-release.jks
```

It asks for the password and prints the alias, the dates the key is valid between, and the certificate's **SHA-256 fingerprint**. That fingerprint is your app's identity in one line. Note it down; you'll use it to check your APKs.

{% include callout.html type="warning" title="Never commit the keystore" text="Not to a private repository either. A private repo can become public by one wrong click, it gets cloned onto other machines, and git keeps every file in its history forever, even after you delete it." %}

## Keep the passwords out of git

Gradle needs four things to sign your app: the keystore's path, its password, the alias and the key password. Writing them straight into `build.gradle.kts` would put them in git. Instead, put them in a separate file that git is told to ignore.

Create `keystore.properties` in the **project root** (next to `gradlew`):

{% include file.html name="keystore.properties" %}

```properties
RELEASE_STORE_FILE=/Users/naz/android-keys/myapp-release.jks
RELEASE_STORE_PASSWORD=your-keystore-password
RELEASE_KEY_ALIAS=myapp
RELEASE_KEY_PASSWORD=your-keystore-password
```

Use the **full path** starting with `/Users/...`. Gradle doesn't understand `~`. Run `echo ~/android-keys/myapp-release.jks` to see the full path to copy.

Now tell git to ignore it. Open `.gitignore` in the project root (create it if it doesn't exist) and add these lines at the end:

{% include file.html name=".gitignore" %}

```gitignore
# Signing secrets: never commit these
keystore.properties
*.jks
*.keystore
```

Check that git really ignores it:

```bash
git status --short
git check-ignore -v keystore.properties
```

`keystore.properties` should **not** appear in `git status`, and `check-ignore` should print the `.gitignore` line that matches it. If `git status` does list it, it was committed before; run `git rm --cached keystore.properties` and commit that.

{% include callout.html type="note" title="Why these exact names?" text="The names look like environment variables on purpose. In step 10, GitHub Actions passes the same four values as environment variables, and the Gradle code in the next step reads whichever one it finds. One build file, two places for the secrets." %}

## Teach Gradle to sign release builds

Open the **app module's** build file: `app/build.gradle.kts`, not the one in the project root. You'll add three things:

1. At the very top, code that loads `keystore.properties` and falls back to environment variables.
2. A `signingConfigs` block that describes your key.
3. One line in the `release` build type that uses it.

{% include file.html name="app/build.gradle.kts" %}

```kotlin
import java.util.Properties

plugins {
    // ... leave your existing plugins exactly as they are ...
}

// Signing secrets come from keystore.properties on your computer,
// or from environment variables on GitHub Actions.
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun secret(name: String): String? =
    keystoreProperties.getProperty(name) ?: System.getenv(name)

val hasReleaseKey = secret("RELEASE_STORE_FILE") != null

android {
    // ... namespace, compileSdk, defaultConfig stay as they are ...

    signingConfigs {
        create("release") {
            if (hasReleaseKey) {
                storeFile = file(secret("RELEASE_STORE_FILE")!!)
                storePassword = secret("RELEASE_STORE_PASSWORD")
                keyAlias = secret("RELEASE_KEY_ALIAS")
                keyPassword = secret("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // ... keep what is already here (isMinifyEnabled, proguardFiles...) ...
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}
```

Reading it in plain words:

- `import java.util.Properties` must be the first line of the file, above `plugins { }`.
- `keystoreProperties` reads `keystore.properties` from the project root, **if it exists**.
- `secret("NAME")` looks for `NAME` in that file first and, if it's not there, in the environment variables.
- `hasReleaseKey` is true only when a keystore path was found.
- The `if (hasReleaseKey)` checks mean that someone who clones your repo **without** your secrets can still build. They just get an unsigned APK instead of a confusing error.

After saving, Android Studio shows a bar saying the Gradle files have changed. Click **Sync Now**.

### If your file is `build.gradle` (Groovy)

Older projects use Groovy instead of Kotlin. The idea is identical; only the spelling changes:

{% include file.html name="app/build.gradle" %}

```groovy
plugins {
    // ... leave your existing plugins exactly as they are ...
}

def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('keystore.properties')
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
def secret = { String name -> keystoreProperties.getProperty(name) ?: System.getenv(name) }
def hasReleaseKey = secret('RELEASE_STORE_FILE') != null

android {
    // ... namespace, compileSdk, defaultConfig stay as they are ...

    signingConfigs {
        release {
            if (hasReleaseKey) {
                storeFile file(secret('RELEASE_STORE_FILE'))
                storePassword secret('RELEASE_STORE_PASSWORD')
                keyAlias secret('RELEASE_KEY_ALIAS')
                keyPassword secret('RELEASE_KEY_PASSWORD')
            }
        }
    }

    buildTypes {
        release {
            // ... keep what is already here ...
            if (hasReleaseKey) {
                signingConfig signingConfigs.release
            }
        }
    }
}
```

## Build the release APK

From the project root:

```bash
./gradlew assembleRelease
```

`gradlew` is the **Gradle wrapper**: a small script in your project that downloads the exact Gradle version your project expects, so you don't have to install Gradle yourself. `assembleRelease` means "build the `release` version of every app module". The first run downloads things and can take a few minutes; later runs are much faster.

When it ends with `BUILD SUCCESSFUL`, your APK is here:

```text
app/build/outputs/apk/release/app-release.apk
```

Look at the **file name**, because it tells you whether signing worked:

| You got | Meaning |
| --- | --- |
| `app-release.apk` | ✅ Signed with your key. Ready to share. |
| `app-release-unsigned.apk` | ❌ Gradle didn't find your secrets, so `hasReleaseKey` was false. Phones won't install this. Check that `keystore.properties` is in the project root, next to `gradlew`, and that the names in it are spelled exactly as above. |

{% include callout.html type="note" title="Release builds are stricter" text="A release build runs extra checks that a debug build skips, such as **lint** (Android's code checker). If the build stops with `Lint found errors`, read the report path it prints: it lists each problem and the file it's in. Fixing them is better than switching lint off." %}

{% include callout.html type="tip" title="Smaller APKs, later" text="In `buildTypes.release`, `isMinifyEnabled = true` lets a tool called R8 remove unused code and shorten names, which can shrink the APK a lot. It can also remove code your app needs if it's loaded in unusual ways. Get your first release out with it set to `false`, then try `true` and test the APK properly before publishing it." %}

## Check the APK before you share it

Two quick checks catch nearly every signing mistake before your users do.

**1. Check the signature.** Android's tool for this is `apksigner`. It lives in the Android SDK's `build-tools` folder, which has one subfolder per version, so use the newest one:

```bash
SDK=~/Library/Android/sdk
APKSIGNER=$(ls -d "$SDK"/build-tools/*/ | sort -V | tail -1)apksigner

"$APKSIGNER" verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk
```

Look for these lines:

```text
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
...
Signer #1 certificate DN: CN=Your Name, ..., C=BD
Signer #1 certificate SHA-256 digest: 3a9f...
```

- `Verifies` means the seal is intact.
- The **DN** should show the name you typed into `keytool`. If it says `CN=Android Debug`, it was signed with the debug key, not yours.
- The **SHA-256 digest** should match the fingerprint you noted in step 3 (it's printed without colons here, but it's the same number). From now on, every release you publish must show this same value.

**2. Install it on a real phone.** Connect your phone with USB debugging turned on, and:

```bash
adb install app/build/outputs/apk/release/app-release.apk
```

If the debug version from Android Studio is already on the phone, this fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. That's the wax-seal rule in action: debug key vs. release key. Uninstall the debug version first (`adb uninstall com.example.myapp`), then install again. Open the app and click around: release builds sometimes behave differently from debug builds, and this is the moment to find out.

## Publish a GitHub Release by hand

A **GitHub Release** is a page on your repository with a version name, some notes, and files attached to download. It's tied to a **git tag**, which is a permanent label on one commit, so anyone can see exactly which code made that APK.

First, commit your work (the Gradle changes and `.gitignore`, but not the secrets), then tag that commit and push both:

```bash
git add .gitignore app/build.gradle.kts
git commit -m "Sign release builds"
git push

git tag v1.0.0
git push origin v1.0.0
```

Give the APK a name that says what it is, since `app-release.apk` means nothing in someone's Downloads folder:

```bash
cp app/build/outputs/apk/release/app-release.apk myapp-v1.0.0.apk
```

Now create the release. **With the GitHub CLI:**

```bash
gh release create v1.0.0 myapp-v1.0.0.apk \
  --title "myapp v1.0.0" \
  --notes "First release."
```

**Or on the website:**

1. Open your repository on github.com and click **Releases** (right-hand side) → **Draft a new release**.
2. **Choose a tag**: pick `v1.0.0`.
3. **Release title**: `myapp v1.0.0`. Write a few lines about what's in it.
4. Drag `myapp-v1.0.0.apk` into the **Attach binaries** box and wait for the upload to finish.
5. Click **Publish release**.

Then delete the copy so it doesn't end up in git: `rm myapp-v1.0.0.apk`.

Your APK now has a public download link:

```text
https://github.com/<your-user>/<your-repo>/releases/download/v1.0.0/myapp-v1.0.0.apk
```

{% include callout.html type="note" title="What your users will see" text="Android blocks APKs from outside the Play Store until the person allows it. When they open the downloaded file, the phone asks them to allow **Install unknown apps** for their browser or file manager. Google Play Protect may also say it doesn't recognise the developer; they can tap **More details → Install anyway**. That's normal for any app not from the Play Store. Mention it in your release notes so nobody is surprised." %}

Steps 1 to 8 are the whole manual process. The rest of this tutorial makes GitHub do it for you.

## Give GitHub your signing secrets

GitHub Actions is GitHub's free build service: on events you choose, it starts a fresh Linux computer in the cloud, runs your commands, and throws the computer away. To sign your APK there, it needs your keystore and passwords, without them ever being in your repository.

**Repository secrets** are the safe place for that. They are stored encrypted, only your workflows can read them, and GitHub hides them in build logs (shown as `***`).

A secret can only hold text, and a keystore is a binary file. So you turn it into text with **base64**, an encoding that writes any file as plain letters and numbers, and the workflow turns it back into the file.

You need four secrets:

| Secret name | Value |
| --- | --- |
| `KEYSTORE_BASE64` | The keystore file, as base64 text |
| `RELEASE_STORE_PASSWORD` | Your keystore password |
| `RELEASE_KEY_ALIAS` | `myapp` |
| `RELEASE_KEY_PASSWORD` | The same password again |

The fifth value Gradle needs, `RELEASE_STORE_FILE`, isn't secret, so it goes in the workflow file itself.

**With the GitHub CLI**, from your project folder:

```bash
base64 -i ~/android-keys/myapp-release.jks | gh secret set KEYSTORE_BASE64
gh secret set RELEASE_STORE_PASSWORD
gh secret set RELEASE_KEY_ALIAS
gh secret set RELEASE_KEY_PASSWORD
```

The first line encodes the keystore and sends it straight to GitHub. Each of the other three asks you to paste the value, so the password never appears in your shell history.

**Or on the website:**

1. Copy the keystore as base64 to your clipboard: `base64 -i ~/android-keys/myapp-release.jks | pbcopy`
2. In your repository on github.com: **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `KEYSTORE_BASE64`, Secret: paste (⌘V). **Add secret**.
4. Repeat for the other three names in the table.

Check the list shows all four names. You can't view a secret's value again after saving it, only replace it, which is by design.

## Add the release workflow

A **workflow** is a recipe file in your repository that tells GitHub Actions what to do and when. This one says: "whenever a tag starting with `v` is pushed, build the signed APK and publish it as a release".

Create the folders `.github/workflows/` in the project root, and this file inside:

{% include file.html name=".github/workflows/release.yml" %}

{% raw %}
```yaml
name: Release APK

on:
  push:
    tags: ["v*"]        # runs for v1.0.0, v1.1.0, v2.0.0 ...

permissions:
  contents: write       # lets the workflow create the release

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Get the code
        uses: actions/checkout@v4

      - name: Install Java
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"

      - name: Set up Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Restore the keystore
        run: echo "$KEYSTORE_BASE64" | base64 --decode > app/release.jks
        env:
          KEYSTORE_BASE64: ${{ secrets.KEYSTORE_BASE64 }}

      - name: Build the signed APK
        run: ./gradlew assembleRelease
        env:
          RELEASE_STORE_FILE: release.jks
          RELEASE_STORE_PASSWORD: ${{ secrets.RELEASE_STORE_PASSWORD }}
          RELEASE_KEY_ALIAS: ${{ secrets.RELEASE_KEY_ALIAS }}
          RELEASE_KEY_PASSWORD: ${{ secrets.RELEASE_KEY_PASSWORD }}

      - name: Publish the GitHub Release
        run: |
          cp app/build/outputs/apk/release/app-release.apk "myapp-${GITHUB_REF_NAME}.apk"
          gh release create "$GITHUB_REF_NAME" "myapp-${GITHUB_REF_NAME}.apk" \
            --title "myapp $GITHUB_REF_NAME" \
            --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```
{% endraw %}

What each part does:

- **`on: push: tags`**: the trigger. Normal pushes to `main` do nothing; only pushing a tag like `v1.1.0` starts a release.
- **`permissions: contents: write`**: by default a workflow can only read your repository. Creating a release needs write access.
- **`runs-on: ubuntu-latest`**: the cloud computer. GitHub's Ubuntu machines come with the Android SDK already installed.
- **Install Java**: Gradle needs Java to run. Android Gradle Plugin 8 needs Java 17 or newer. If your project's Gradle settings ask for a newer Java, change `"17"` to match.
- **Set up Gradle**: caches Gradle's downloads between runs, so the second release builds much faster.
- **Restore the keystore**: decodes the base64 secret back into the `.jks` file, inside the `app` folder.
- **Build the signed APK**: runs the same command you ran by hand. This time there's no `keystore.properties`, so your Gradle code reads the four `RELEASE_...` **environment variables** instead. `RELEASE_STORE_FILE: release.jks` is a path relative to the `app` folder, which is where the previous step put the file.
- **Publish the GitHub Release**: `GITHUB_REF_NAME` is filled in by GitHub with the tag's name (`v1.1.0`). The step renames the APK and creates the release. `--generate-notes` writes the release notes for you from the commits since the last release. `GH_TOKEN` is a temporary key GitHub creates for each run, so `gh` is allowed to make the release.

The cloud computer is deleted when the run ends, keystore and all.

Change `myapp` to your app's name in the last step, then commit and push the workflow:

```bash
git add .github/workflows/release.yml
git commit -m "Build and publish release APKs on version tags"
git push
```

Pushing the workflow alone doesn't start anything, because no tag was pushed.

{% include callout.html type="warning" title="Only you should push tags" text="Anyone who can push to your repository can push a tag and get an APK signed with your key. On a personal repository that's only you. If you add collaborators later, look at GitHub's **tag rulesets** (Settings → Rules) to limit who can create `v*` tags." %}

## Release a new version with one tag

This is the routine from now on. Say you've fixed some bugs and want to release 1.1.0:

**1.** In `app/build.gradle.kts`, raise both numbers:

```kotlin
versionCode = 2          // was 1: must always go up
versionName = "1.1.0"    // was "1.0.0"
```

**2.** Commit, tag with the **same** version, and push both:

```bash
git commit -am "Release 1.1.0"
git push
git tag v1.1.0
git push origin v1.1.0
```

**3.** Watch it run, in the **Actions** tab of your repository on github.com, or from the terminal:

```bash
gh run watch
```

After a few minutes the run turns green, and **Releases** shows **myapp v1.1.0** with `myapp-v1.1.0.apk` attached. Download it on your phone and install it **over** the old version: it updates in place, with the app's data kept. That's proof the new APK carries the same signature as the old one.

{% include callout.html type="tip" title="Check a release from GitHub" text="To be sure a published APK carries your key, download it and run the `apksigner verify --print-certs` command from step 7 on it. The SHA-256 digest must be the same for every release you ever publish." %}

## A permanent link to the latest version
{: .no-step}

GitHub has a link that always points at the newest release:

```text
https://github.com/<your-user>/<your-repo>/releases/latest
```

That's the link to put in your README or on your website. It opens the release page with the APK to download.

## Quick reference
{: .no-step}

| Task | Command |
| --- | --- |
| Create a keystore | `keytool -genkeypair -v -keystore ~/android-keys/myapp-release.jks -alias myapp -keyalg RSA -keysize 2048 -validity 10000` |
| Show what's in a keystore | `keytool -list -v -keystore ~/android-keys/myapp-release.jks` |
| Build a signed release APK | `./gradlew assembleRelease` |
| Where the APK lands | `app/build/outputs/apk/release/app-release.apk` |
| Check an APK's signature | `apksigner verify --verbose --print-certs app-release.apk` |
| Install on a connected phone | `adb install app-release.apk` |
| Release by hand | `gh release create v1.0.0 myapp-v1.0.0.apk --title "myapp v1.0.0" --notes "..."` |
| Release with the workflow | Bump `versionCode` and `versionName`, commit, then `git tag v1.1.0 && git push origin v1.1.0` |
| Keystore → secret | `base64 -i ~/android-keys/myapp-release.jks \| gh secret set KEYSTORE_BASE64` |
| Watch the workflow | `gh run watch` |

## Quick memory hooks
{: .no-step}

- **The key is the app's identity.** Same key forever, or users can't update.
- **Back it up, never commit it.** Password manager for the password, a safe copy for the file.
- **`versionCode` always goes up.** `versionName` is just for people.
- **`-unsigned` in the file name means Gradle didn't find your secrets.**
- **Tag = release.** The tag `v1.1.0`, `versionName "1.1.0"` and the APK name all match.

## Troubleshooting
{: .no-step}

- **`keytool: command not found`** or **`Unable to locate a Java Runtime`** in the Mac's Terminal: use Android Studio's own Java. Run `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` and `export PATH="$JAVA_HOME/bin:$PATH"`, then try again. Add both lines to `~/.zshrc` to keep them. Or just use Android Studio's Terminal tab.
- **`app-release-unsigned.apk` instead of `app-release.apk`**: Gradle didn't find `RELEASE_STORE_FILE`. Locally, check `keystore.properties` is in the project root (next to `gradlew`, not inside `app`) and the names are spelled exactly. On GitHub, check the four secrets exist with exactly those names.
- **`Keystore file '.../~/android-keys/...' not found`**: you wrote `~` in `keystore.properties`. Use the full path, starting `/Users/`.
- **`Keystore was tampered with, or password was incorrect`**: the store password is wrong. On GitHub, re-create the secret; a space or newline pasted at the end is a common cause.
- **`Cannot recover key`** or **`Failed to read key myapp from store`**: the key password or the alias is wrong. With a PKCS12 keystore, the key password is the same as the store password. Run `keytool -list -keystore ...` to see the real alias.
- **`INSTALL_FAILED_UPDATE_INCOMPATIBLE`** or **"App not installed as package conflicts with an existing package"**: the version on the phone was signed with a different key, usually the debug build from Android Studio. Uninstall it and install again.
- **`INSTALL_FAILED_VERSION_DOWNGRADE`**: the APK's `versionCode` is lower than the installed one. Raise `versionCode`.
- **`./gradlew: Permission denied`** on GitHub Actions: the wrapper lost its "executable" mark, usually after being copied from Windows. Run `git update-index --chmod=+x gradlew`, commit and push.
- **`Android Gradle plugin requires Java 17 to run`** or **`Unsupported class file major version`**: the workflow's Java is older than your project needs. Change `java-version` in the workflow.
- **`HTTP 403: Resource not accessible by integration`** from `gh release create`: the `permissions: contents: write` block is missing or misspelled in the workflow.
- **`a release with the same tag name already exists`**: you already published that version, maybe by hand. Delete that release on GitHub (or with `gh release delete v1.1.0`) and re-run the workflow from the Actions tab, or release a new version number.
- **Pushed a tag with a mistake in it**: delete the tag everywhere with `git tag -d v1.1.0` and `git push origin :refs/tags/v1.1.0`, delete its release if one was made, fix the code, and tag again. Only do this before anyone has downloaded it; otherwise release `v1.1.1` instead.
- **`base64: invalid input`** in the "Restore the keystore" step: the secret isn't the full base64 text. Set it again with the `gh secret set` command, which copies it exactly.
