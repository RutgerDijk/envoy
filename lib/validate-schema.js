'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMAS_DIR = path.join(__dirname, 'schemas');
const schemaCache = new Map();

function loadSchema(name) {
  if (schemaCache.has(name)) return schemaCache.get(name);
  const file = path.join(SCHEMAS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`schema not found: ${name} (${file})`);
  }
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  schemaCache.set(name, schema);
  return schema;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number';
  if (type === 'string') return actual === 'string';
  if (type === 'boolean') return actual === 'boolean';
  if (type === 'array') return actual === 'array';
  if (type === 'object') return actual === 'object';
  if (type === 'null') return actual === 'null';
  return false;
}

function validateValue(schema, value, errors, pathStr) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matchesType(value, t))) {
      errors.push(`${pathStr || '<root>'}: expected ${types.join('|')}, got ${typeOf(value)}`);
      return;
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${pathStr || '<root>'}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${pathStr || '<root>'}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    return;
  }

  if (schema.type === 'object' && typeOf(value) === 'object') {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push(`${pathStr ? pathStr + '.' : ''}${key}: required field missing`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in value) {
          validateValue(subSchema, value[key], errors, pathStr ? `${pathStr}.${key}` : key);
        }
      }
    }
  }

  if (schema.type === 'array' && typeOf(value) === 'array' && schema.items) {
    value.forEach((item, i) => {
      validateValue(schema.items, item, errors, `${pathStr || '<root>'}[${i}]`);
    });
  }
}

function validate(schemaName, data) {
  const schema = loadSchema(schemaName);
  const errors = [];
  validateValue(schema, data, errors, '');
  return { valid: errors.length === 0, errors };
}

function validateFile(schemaName, filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: [`file not found: ${filePath} (ENOENT)`] };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`invalid JSON in ${filePath}: ${err.message}`] };
  }
  return validate(schemaName, data);
}

module.exports = { validate, loadSchema, validateFile, SCHEMAS_DIR };
