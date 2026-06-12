process.env.MYFLIX_DISABLE_DEMO_SEED = process.env.MYFLIX_DISABLE_DEMO_SEED || 'true';

const { runLibraryScan } = require('../lib/libraryScanner');

const forceRescan = process.argv.includes('--force');

runLibraryScan({
  trigger: forceRescan ? 'cli-force' : 'cli',
  forceRescan
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
