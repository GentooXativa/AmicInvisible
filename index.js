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

const sendErrorPage = (res, message) => {
  const htmlTemplate = readFileSync('./error.html', 'utf8');
  const html = htmlTemplate.replace('{{error_message}}', message);
  res.status(400).send(html);
};

app.get('/', (req, res) => {
  sendErrorPage(res, "T'has equivocat de link! Torna a mirar el missatge del WhatsApp.");
});

app.get('/qui-hem-toca-a-mi/:id', (req, res) => {
  const { id } = req.params;
  debug(`Request for id: ${id}`);

  const uuidsFile = './data/uuids.json';

  if (!existsSync(uuidsFile)) {
    sendErrorPage(res, 'El joc encara no ha sigut inicialitzat.');
    return;
  }

  const uuids = JSON.parse(readFileSync(uuidsFile, 'utf8'));

  const person = uuids.find((item) => item.id === id);

  if (person) {
    const assignmentsFile = './data/assignments.json';

    if (!existsSync(assignmentsFile)) {
      sendErrorPage(res, 'Les assignacions encara no estan preparades.');
      return;
    }

    const assignments = JSON.parse(readFileSync(assignmentsFile, 'utf8'));

    // Find who this person has to give a gift to
    const assignment = assignments.find((item) => item.giver === person.person);

    if (assignment) {
      const target = checkHashedPerson(assignment.receiver);
      const self = checkHashedPerson(person.person);

      if (!target || !self) {
        sendErrorPage(res, 'Hi ha hagut un error buscant les dades.');
        return;
      }

      const htmlTemplate = readFileSync('./index.html', 'utf8');

      const html = htmlTemplate
        .replace(/{{target}}/g, target)
        .replace(/{{self}}/g, self);

      res.send(html);
    } else {
      sendErrorPage(res, 'No hem trobat la teua assignació. Contacta amb l\'organitzador.');
    }
  } else {
    sendErrorPage(res, 'Aquest link no és vàlid. Assegura\'t de copiar-lo sencer!');
  }
});

const randomizeArrayItems = (array) => {
  const newArray = [];
  const arrayCopy = [...array];

  while (arrayCopy.length > 0) {
    const randomIndex = Math.floor(Math.random() * arrayCopy.length);
    const randomItem = arrayCopy.splice(randomIndex, 1)[0];
    newArray.push(randomItem);
  }

  return newArray;
};

const hashPerson = (name) => crypto.createHash('sha256').update(name).digest('hex');

const hashArrayItems = (array) => array.map((item) => hashPerson(item));

/**
 * Algorisme de l'Amic Invisible:
 * Crea un cercle on cada persona dona un regal a la següent.
 * Persona[0] → Persona[1] → Persona[2] → ... → Persona[n-1] → Persona[0]
 *
 * Regles:
 * - Ningú es pot tocar a si mateix
 * - Cada persona dona exactament un regal
 * - Cada persona rep exactament un regal
 * - Qui et dona el regal és diferent de qui tu dones el regal
 */
const createCircleAssignments = (hashedArray) => {
  const assignments = [];

  for (let i = 0; i < hashedArray.length; i += 1) {
    const giver = hashedArray[i];
    // Each person gives to the next one, last person gives to the first
    const receiver = hashedArray[(i + 1) % hashedArray.length];

    assignments.push({ giver, receiver });
  }

  return assignments;
};

const init = () => {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));

  if (config.people.length < 2) {
    console.error('Error: Cal almenys 2 persones per a l\'amic invisible!');
    return;
  }

  // Randomize the order of people
  const randomizedArray = randomizeArrayItems(config.people);

  // Hash all names for privacy
  const hashedArray = hashArrayItems(randomizedArray);

  // Create circle assignments (proper Secret Santa algorithm)
  // Each person gives to the next one in the circle
  const assignments = createCircleAssignments(hashedArray);

  debug(`Total participants: ${hashedArray.length}`);
  debug(`Total assignments: ${assignments.length}`);

  // Generate UUID for each person
  const uuids = [];
  hashedArray.forEach((person) => {
    uuids.push({ id: uuid.v4(), person });
  });

  // Save UUIDs to file
  const uuidsFile = './data/uuids.json';
  if (!existsSync(uuidsFile)) {
    writeFileSync(uuidsFile, JSON.stringify(uuids, null, 2), 'utf8');
    debug('UUIDs saved to file');
  }

  // Save assignments to file
  const assignmentsFile = './data/assignments.json';
  if (!existsSync(assignmentsFile)) {
    writeFileSync(assignmentsFile, JSON.stringify(assignments, null, 2), 'utf8');
    debug('Assignments saved to file');
  }
};

const dumpUrls = () => {
  const uuidsFile = './data/uuids.json';
  const uuids = JSON.parse(readFileSync(uuidsFile, 'utf8'));

  console.log('\n🎄 URLs per a l\'Amic Invisible 🎄\n');
  console.log('='.repeat(60));

  const urls = [];

  uuids.forEach((item) => {
    const who = checkHashedPerson(item.person);
    const url = `${publicUrl}/qui-hem-toca-a-mi/${item.id}`;
    urls.push({ name: who, url });
  });

  // Sort by name and print
  urls.sort((a, b) => a.name.localeCompare(b.name));
  urls.forEach(({ name, url }) => {
    console.log(`\n📧 ${name}`);
    console.log(`   ${url}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Total: ${urls.length} participants\n`);
};

app.listen(port, () => {
  debug(`Example app listening at http://0.0.0.0:${port}`);
  const config = JSON.parse(readFileSync(configFile, 'utf8'));

  debug(`Total people into config: ${config.people.length}`);

  if (!existsSync('./data') || !existsSync('./data/assignments.json')) {
    if (!existsSync('./data')) {
      mkdirSync('./data');
    }

    init();
    dumpUrls();
  } else {
    dumpUrls();
  }
});
