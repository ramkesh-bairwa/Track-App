// electron-builder afterPack hook (macOS): sign the packed .app before it is
// put into the DMG/zip.
//
// electron-builder finds no Apple "Developer ID" certificate here and so skips
// signing entirely, which left the app with a broken seal — on Apple Silicon
// macOS then refuses it as "damaged and can't be opened". Signing it here (with
// the local "MyTrack Local Signing" certificate if present, otherwise ad-hoc,
// via scripts/sign-mac-local.sh) gives the bundle a valid signature, so the app
// opens (right-click → Open the first time, as it is not notarized).
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const signer = path.join(__dirname, 'sign-mac-local.sh');
  console.log(`  · afterPack: signing ${appName}…`);
  execFileSync('bash', [signer, appPath], { stdio: 'inherit' });
};
