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

// Twilio client (initialized lazily)
let twilioClient = null;

const getTwilioClient = (config) => {
  if (!twilioClient && config.twilio && !config.skipSms) {
    // eslint-disable-next-line global-require
    const twilio = require('twilio');
    twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
  }
  return twilioClient;
};

/**
 * Find person by hashed value
 * @param {string} hashedPerson - SHA256 hash of person name
 * @returns {object|false} - Person object {name, phone} or false if not found
 */
const findPersonByHash = (hashedPerson) => {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const { people } = config;

  let found = false;

  people.forEach((person) => {
    const hash = crypto.createHash('sha256').update(person.name).digest('hex');

    if (hash === hashedPerson) {
      found = person;
    }
  });

  return found;
};

/**
 * Get person name by hash (for display purposes)
 */
const getNameByHash = (hashedPerson) => {
  const person = findPersonByHash(hashedPerson);
  return person ? person.name : false;
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

  const personEntry = uuids.find((item) => item.id === id);

  if (personEntry) {
    const assignmentsFile = './data/assignments.json';

    if (!existsSync(assignmentsFile)) {
      sendErrorPage(res, 'Les assignacions encara no estan preparades.');
      return;
    }

    const assignments = JSON.parse(readFileSync(assignmentsFile, 'utf8'));

    // Find who this person has to give a gift to
    const assignment = assignments.find((item) => item.giver === personEntry.person);

    if (assignment) {
      const target = getNameByHash(assignment.receiver);
      const self = getNameByHash(personEntry.person);

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

/**
 * Send SMS via Twilio
 */
const sendSms = async (config, toNumber, message) => {
  const client = getTwilioClient(config);

  if (!client) {
    return { success: false, error: 'Twilio client not initialized' };
  }

  try {
    const result = await client.messages.create({
      body: message,
      from: config.twilio.fromNumber,
      to: toNumber,
    });

    return { success: true, sid: result.sid };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Send notifications to all participants (SMS or console)
 */
const sendNotifications = async (config, uuids) => {
  console.log('\n📨 Enviant notificacions...\n');
  console.log('='.repeat(60));

  const results = [];

  for (const entry of uuids) {
    const person = findPersonByHash(entry.person);

    if (!person) {
      console.log(`❌ Error: No s'ha trobat la persona amb hash ${entry.person}`);
      continue;
    }

    const url = `${publicUrl}/qui-hem-toca-a-mi/${entry.id}`;
    const message = `🎄 Hola ${person.name}! Ací tens el teu link per a l'Amic Invisible: ${url}`;

    if (config.skipSms) {
      // Mode de proves: mostrar per consola
      console.log(`\n📱 [MODE PROVES] SMS per a ${person.name}:`);
      console.log(`   Telèfon: ${person.phone}`);
      console.log(`   Missatge: ${message}`);
      results.push({ name: person.name, status: 'skipped (test mode)' });
    } else {
      // Mode producció: enviar SMS real via Twilio
      console.log(`\n📤 Enviant SMS a ${person.name} (${person.phone})...`);

      // eslint-disable-next-line no-await-in-loop
      const result = await sendSms(config, person.phone, message);

      if (result.success) {
        console.log(`   ✅ Enviat! SID: ${result.sid}`);
        results.push({ name: person.name, status: 'sent', sid: result.sid });
      } else {
        console.log(`   ❌ Error: ${result.error}`);
        results.push({ name: person.name, status: 'error', error: result.error });
      }
    }
  }

  console.log('\n' + '='.repeat(60));

  // Summary
  const sent = results.filter((r) => r.status === 'sent').length;
  const skipped = results.filter((r) => r.status.includes('skipped')).length;
  const errors = results.filter((r) => r.status === 'error').length;

  if (config.skipSms) {
    console.log(`\n⚠️  MODE PROVES ACTIVAT (skipSms: true)`);
    console.log(`   Els SMS no s'han enviat realment.`);
    console.log(`   Per enviar SMS de veritat, posa "skipSms": false a la config.\n`);
  } else {
    console.log(`\n📊 Resum: ${sent} enviats, ${errors} errors\n`);
  }

  return results;
};

const init = async () => {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));

  if (!config.people || config.people.length < 2) {
    console.error('Error: Cal almenys 2 persones per a l\'amic invisible!');
    return;
  }

  // Validate people structure
  const invalidPeople = config.people.filter((p) => !p.name || !p.phone);
  if (invalidPeople.length > 0) {
    console.error('Error: Cada persona ha de tenir "name" i "phone"!');
    return;
  }

  // Randomize the order of people
  const randomizedPeople = randomizeArrayItems(config.people);

  // Extract names and hash them
  const hashedArray = randomizedPeople.map((p) => hashPerson(p.name));

  // Create circle assignments (proper Secret Santa algorithm)
  const assignments = createCircleAssignments(hashedArray);

  debug(`Total participants: ${hashedArray.length}`);
  debug(`Total assignments: ${assignments.length}`);

  // Generate UUID for each person
  const uuids = [];
  hashedArray.forEach((personHash) => {
    uuids.push({ id: uuid.v4(), person: personHash });
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

  // Send notifications to all participants
  await sendNotifications(config, uuids);
};

const dumpUrls = () => {
  const uuidsFile = './data/uuids.json';
  const uuids = JSON.parse(readFileSync(uuidsFile, 'utf8'));

  console.log('\n🎄 URLs per a l\'Amic Invisible 🎄\n');
  console.log('='.repeat(60));

  const urls = [];

  uuids.forEach((item) => {
    const person = findPersonByHash(item.person);
    if (person) {
      const url = `${publicUrl}/qui-hem-toca-a-mi/${item.id}`;
      urls.push({ name: person.name, phone: person.phone, url });
    }
  });

  // Sort by name and print
  urls.sort((a, b) => a.name.localeCompare(b.name));
  urls.forEach(({ name, phone, url }) => {
    console.log(`\n📧 ${name} (${phone})`);
    console.log(`   ${url}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ Total: ${urls.length} participants\n`);
};

app.listen(port, async () => {
  debug(`Example app listening at http://0.0.0.0:${port}`);
  const config = JSON.parse(readFileSync(configFile, 'utf8'));

  debug(`Total people into config: ${config.people.length}`);

  if (!existsSync('./data') || !existsSync('./data/assignments.json')) {
    if (!existsSync('./data')) {
      mkdirSync('./data');
    }

    await init();
    dumpUrls();
  } else {
    dumpUrls();
  }
});
