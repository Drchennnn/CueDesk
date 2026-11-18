'use strict';
const fs = require('node:fs');
const {createVectorSource} = require('../v2/vector-source.cjs');

const [optionsFile, output] = process.argv.slice(2);
const options = JSON.parse(fs.readFileSync(optionsFile, 'utf8').replace(/^\uFEFF/, ''));
createVectorSource().snapshot(options, output).then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
