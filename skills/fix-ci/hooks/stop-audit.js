#!/usr/bin/env node
'use strict';

const path = require('path');
const REPO_ROOT = process.env.ENVOY_REPO_ROOT || path.resolve(__dirname, '..', '..', '..');
const { runStopAudit } = require(path.join(REPO_ROOT, 'lib', 'contract-guard'));
process.exit(runStopAudit(path.join(__dirname, '..', 'contract.json')));
