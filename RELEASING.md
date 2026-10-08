# Releasing observe_desk

How installers and updates get from this repository to people's PCs. **None of this pipeline has been run yet**: the pieces were tested separately (see the end), but the first real release is the real test. Do the one-time setup, then follow "Making a release".

## How it fits together

1. You push a tag like `v0.2.0`.
2. GitHub Actions (`.github/workflows/release.yml`) builds the Windows installer, **signs it** (code signing, so Windows trusts the publisher) and **signs the update** (update key, so installed apps trust the download), then creates a **draft** release with the installer, a `.sig` file and `latest.json`.
3. You try the installer, then **publish** the draft.
4. Installed copies check `https://github.com/nat-30102000/observe_desk/releases/latest/download/latest.json` (on start, then every 6 hours), see the new version, check the update's signature against the public key built into the app, and offer to install it (or install it themselves, if that is switched on).

There are two different signatures. They solve different problems and you need to set up both:

| | Update signature | Windows code signing |
| --- | --- | --- |
| Protects against | A tampered or fake update being installed by the app | The "Windows protected your PC" warning; shows your name as publisher |
| Made with | A key pair you generate for free | A certificate from a Microsoft-trusted source (costs money) |
| Required for auto-update | Yes | No |
| Required to avoid the warning | No | Yes (and see the SmartScreen note) |

## One-time setup

### 1. The update key (free, required)

```powershell
npx tauri signer generate -w "$HOME\.tauri\observe_desk.key"
```

It asks for a password (use one) and writes two files: `observe_desk.key` (**private**) and `observe_desk.key.pub` (public).

- Open `apps/desk/src-tauri/tauri.release.conf.json` and replace `REPLACE_WITH_UPDATER_PUBLIC_KEY` with the **entire contents of the `.pub` file**. Commit that change. A public key is safe to publish.
- In GitHub: Settings > Secrets and variables > Actions > New repository secret:
  - `TAURI_SIGNING_PRIVATE_KEY`: the entire contents of `observe_desk.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password
- **Back up the private key and its password** somewhere safe (a password manager). If you lose either, you can never publish another update that existing installs will accept: everyone would have to reinstall by hand. **Never commit the private key**; `*.key` is in `.gitignore`.
- Changing the public key later has the same effect as losing the key: installs built with the old key reject updates signed with the new one.

### 2. Windows code signing (optional but recommended)

Without it the installer still works and updates still install, but Windows SmartScreen shows "Windows protected your PC / Unknown publisher" for the first download of each release, and the publisher shows as unknown. Choose one:

**A. Azure Trusted Signing** (Microsoft's signing service, a monthly fee, no certificate file to guard; check eligibility and current pricing, as availability depends on country and organisation type). Create the account and a certificate profile in Azure, create an app registration with the signing role, then in GitHub:
- Variables: `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`
- Secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`

**B. A certificate from a certificate authority (OV or EV).** Since 2023 the private key of a new code-signing certificate must live on a hardware token or cloud HSM, so a plain `.pfx` file is only possible with some providers or older certificates. If yours gives you a `.pfx`:
- Secrets: `WINDOWS_CERTIFICATE` (the `.pfx` encoded with `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`) and `WINDOWS_CERTIFICATE_PASSWORD`
- For a cloud or HSM certificate, your provider will give you a signing command. Put it in `bundle.windows.signCommand` (the workflow's "Prepare code signing" step shows where; `%1` stands for the file to sign).

**C. Neither.** Leave the secrets empty. The workflow warns and builds an unsigned installer.

SmartScreen note: even a signed installer can show a warning until Microsoft has seen enough downloads of it ("reputation"). Signing is what makes reputation possible and shows your name, but it does not promise silence on day one.

### 3. Check it works before relying on it

- Add the secrets, then run **Actions > Release > Run workflow** with a tag that exists, or push a throwaway tag like `v0.1.1-test`, and read the log. The workflow stops early with a clear message if the update key is still the placeholder, a secret is missing, or the tag does not match the version in the code.

## Making a release

```powershell
node scripts/release-tools.mjs set-version 0.2.0   # updates package.json, tauri.conf.json, Cargo.toml, Cargo.lock
git add -A
git commit -m "Release 0.2.0"
git push
git tag v0.2.0
git push origin v0.2.0
```

1. Watch **Actions > Release**. When it finishes there is a **draft** release `v0.2.0`.
2. Download the installer from the draft and try it on a clean machine or a spare Windows account. Check the publisher in the installer's properties (Digital Signatures tab) if you signed it.
3. **Publish** the release. Installed copies pick it up within about 6 hours, or at once via Desk > Settings > Updates > Check for updates.

To check a signature yourself:

```powershell
Get-AuthenticodeSignature .\observe_desk_0.2.0_x64-setup.exe | Format-List
signtool verify /pa /v .\observe_desk_0.2.0_x64-setup.exe
```

## Trying the update path

1. Install the older version (for example 0.1.1 built from a tag).
2. Publish a newer version (0.1.2).
3. In the old install: Desk > Settings > Updates > **Check for updates**. It should show "Version 0.1.2 is ready"; **Update and restart** installs and reopens the app. Nib also announces new versions once, and the Nib menu gets an "Update to ..." button.
4. Things worth checking: queued captures are still there after the restart; with "Install them by myself" ticked, nothing installs while captures are being filed.

## When something goes wrong

- **A bad release is published:** delete it (or mark it as a pre-release) so `releases/latest` points at the previous good one. The app **never downgrades**, so anyone who already installed the bad one needs a *newer* fixed version: publish `0.2.1`.
- **Installs say the update failed:** the Settings > Updates panel shows the reason. A signature error means the installed app's public key does not match the key that signed the release.
- **The release workflow fails at "Check the installer and update signature":** the build either did not sign the installer when it should have, or the update signature does not record the version. In the second case set `"requireSignedVersion": false` in `tauri.release.conf.json` (it trades away protection against being served an old, genuine release) or update `@tauri-apps/cli`.

## Security notes

- Updates are accepted only if their signature verifies against the public key compiled into the app, they come from the HTTPS address in `tauri.release.conf.json`, and (`requireSignedVersion`) the signature was made for exactly the version the update server announced. That last check stops someone who could tamper with `latest.json` from pushing you back to an older, genuine but vulnerable release.
- Development and local builds have no update key, so they never contact an update server (the Updates panel says so).
- The installer installs for the current user only (no administrator prompt), so updates do not ask for permission each time.

## What has and has not been tested

Tested here: the version and release checks (`scripts/release-tools.mjs`, with unit tests); the update logic in the app (checking, announcing once, installing, the auto-install rules, errors); that the Rust code compiles on Linux and for Windows; that a key pair can be generated and a file signed with the Tauri CLI; and, in the real packaged app on Linux with a throwaway key and a local fake update server, that the updater only switches on when a real key is configured, that the app fetches `latest.json`, and that the Settings > Updates panel then shows "Version 99.0.0 is ready" with its notes.

**Not tested** (needs your GitHub account, keys and a Windows machine): downloading and installing an update (only the check was exercised), the GitHub Actions workflows themselves, building the NSIS installer, Windows code signing with any certificate or service, the `latest.json` that `tauri-action` writes, and a real update from one installed version to the next. The signing commands follow Tauri's documented options but I could not read the current documentation from here, so check them against it: <https://v2.tauri.app/distribute/sign/windows/>.
