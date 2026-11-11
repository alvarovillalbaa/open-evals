import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'harbor-browser.spec.mjs',workers:1,retries:0,timeout:45000,
  reporter:[['list'],['json',{outputFile:process.env.HARBOR_PROOF+'/browser-results.json'}]],
  outputDir:process.env.HARBOR_WORK+'/browser-output',use:{browserName:'chromium',headless:true,trace:'off',video:'off',screenshot:'off'}});
