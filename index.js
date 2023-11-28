const debug = require('debug')('service');

require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const {
  readFileSync, existsSync, writeFileSync, mkdirSync,
} = require('fs');

const uuid = require('uuid');

const configFile = process.env.CONFIG_FILE || './test_config.json';
const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';

const app = express();
const port = process.env.PORT || 3000;

const checkHashedPerson = (hashedPerson) => {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const { people } = config;

  let found = false;

  people.forEach((item) => {
    const hash = crypto.createHash('sha256').update(item).digest('hex');

    if (hash === hashedPerson) {
      found = item;
    }
  });

  return found;
};

app.get('/', (req, res) => {
  res.send("T'has equivocat, torna a mirar el link del whatsapp");
});

app.get('/qui-hem-toca-a-mi/:id', (req, res) => {
  const { id } = req.params;
  debug(`Request for id: ${id}`);

  const uuidsFile = './data/uuids.json';
  const uuids = JSON.parse(readFileSync(uuidsFile, 'utf8'));

  const person = uuids.find((item) => item.id === id);

  if (person) {
    const pairsFile = './data/pairs.json';
    const pairs = JSON.parse(readFileSync(pairsFile, 'utf8'));

    const pair = pairs.find((item) => item.includes(person.person));

    if (pair) {
      const otherPerson = pair.find((item) => item !== person.person);
      const otherPersonUuid = uuids.find((item) => item.person === otherPerson);

      const target = checkHashedPerson(otherPersonUuid.person);
      const self = checkHashedPerson(person.person);

      const htmlTemplate = readFileSync('./index.html', 'utf8');

      const html = htmlTemplate
        .replace('{{target}}', target)
        .replace('{{self}}', self);

      res.send(html);
    } else {
      res.send({});
    }
  } else {
    res.status(500);
    res.send({});
  }
});

const randomizeArrayItems = (array) => {
  const newArray = [];

  while (array.length > 0) {
    const randomIndex = Math.floor(Math.random() * array.length);
    const randomItem = array.splice(randomIndex, 1)[0];
    newArray.push(randomItem);
  }

  return newArray;
};

const hashArrayItems = (array) => {
  const hashedArray = array.map((item) => crypto.createHash('sha256').update(item).digest('hex'));
  return hashedArray;
};

const init = () => {
  let randomizedArray = [];
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  randomizedArray = randomizeArrayItems(config.people);

  debug(`Randomized array: ${randomizedArray}`);

  // const hashedArray = randomizedArray;
  const hashedArray = hashArrayItems(randomizedArray);

  debug(`Hashed array: ${hashedArray}`);

  // generate pair of people without repeat
  const pairs = [];
  let pair = [];
  let pairIndex = 0;
  let pairCount = 0;

  hashedArray.forEach((item) => {
    if (pairIndex === 0) {
      pair = [];
      pair.push(item);
      pairIndex += 1;
    } else {
      pair.push(item);
      pairIndex = 0;
      pairs.push(pair);
      pairCount += 1;
    }
  });

  debug(`Total pairs: ${pairCount}`);

  // generate uuid for each people
  const uuids = [];
  hashedArray.forEach((person) => {
    uuids.push({ id: uuid.v4(), person });
  });

  // save uuids into file
  const uuidsFile = './data/uuids.json';
  if (!existsSync(uuidsFile)) {
    writeFileSync(uuidsFile, JSON.stringify(uuids), 'utf8');
  }

  // save pairs into file
  const pairsFile = './data/pairs.json';
  if (!existsSync(pairsFile)) {
    writeFileSync(pairsFile, JSON.stringify(pairs), 'utf8');
  }
};

const dumpUrls = () => {
  const uuidsFile = './data/uuids.json';
  const uuids = JSON.parse(readFileSync(uuidsFile, 'utf8'));

  const urls = [];

  uuids.forEach((item) => {
    const who = checkHashedPerson(item.person);
    urls.push(`${who.padEnd(' ', 20)} - ${publicUrl}/qui-hem-toca-a-mi/${item.id}`);
  });

  console.dir(urls.sort());
};

app.listen(port, () => {
  debug(`Example app listening at http://0.0.0.0:${port}`);
  const config = JSON.parse(readFileSync(configFile, 'utf8'));

  debug(`Total people into config: ${config.people.length}`);

  if (!existsSync('./data')) {
    mkdirSync('./data');
    init();
    dumpUrls();
  } else {
    dumpUrls();
  }
});
