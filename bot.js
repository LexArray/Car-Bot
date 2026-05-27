// Car Role Bot - dynamically creates/assigns car roles via slash commands
// Run: node bot.js  (after `npm install discord.js dotenv`)

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID; // optional: for instant command updates while testing

// Prefix we put in role names so we know which roles this bot manages.
// Zero-width space makes it invisible in the UI but still detectable in code.
const CAR_ROLE_PREFIX = '\u200B';

// ---- helpers ----------------------------------------------------------------

const titleCase = (s) =>
  s.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const buildCarName = (make, model, year, transmission) => {
  let name = `${titleCase(make)} ${titleCase(model)} (${year})`;
  if (transmission) name += ` [${titleCase(transmission)}]`;
  return name;
};

const isCarRole = (role) => role.name.startsWith(CAR_ROLE_PREFIX);

const carDisplayName = (role) => role.name.slice(CAR_ROLE_PREFIX.length);

const randomColor = () => Math.floor(Math.random() * 0xffffff);

// ---- slash command definitions ---------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName('addcar')
    .setDescription('Add a car to your profile (creates the role if needed)')
    .addStringOption((o) =>
      o.setName('make').setDescription('e.g. Toyota').setRequired(true).setMaxLength(40),
    )
    .addStringOption((o) =>
      o.setName('model').setDescription('e.g. Supra').setRequired(true).setMaxLength(40),
    )
    .addIntegerOption((o) =>
      o.setName('year').setDescription('e.g. 2005').setRequired(true).setMinValue(1900).setMaxValue(2100),
    )
    .addStringOption((o) =>
      o.setName('transmission').setDescription('e.g. MT, AT').setMaxLength(30),
    ),

  new SlashCommandBuilder()
    .setName('removecar')
    .setDescription('Remove one of your car roles')
    .addStringOption((o) =>
      o
        .setName('car')
        .setDescription('Which car to remove')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  new SlashCommandBuilder()
    .setName('mycars')
    .setDescription('List the cars on your profile'),

  new SlashCommandBuilder()
    .setName('listcars')
    .setDescription('List every car role in this server'),
].map((c) => c.toJSON());

// ---- command registration --------------------------------------------------

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log('Registered guild commands (instant). Cleared global commands.');
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Registered global commands (may take up to 1 hour to appear).');
  }
}

// ---- client ----------------------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ---- command handlers ------------------------------------------------------

async function handleAddCar(interaction) {
  const make = interaction.options.getString('make', true);
  const model = interaction.options.getString('model', true);
  const year = interaction.options.getInteger('year', true);
  const transmission = interaction.options.getString('transmission');
  const carName = buildCarName(make, model, year, transmission);
  const roleName = CAR_ROLE_PREFIX + carName;

  const guild = interaction.guild;
  const me = guild.members.me;

  // bot needs Manage Roles
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({
      content: 'I need the **Manage Roles** permission to do that.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // find existing role (case-insensitive) or create a new one
  let role = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === roleName.toLowerCase(),
  );

  if (!role) {
    try {
      role = await guild.roles.create({
        name: roleName,
        color: randomColor(),
        mentionable: true,
        reason: `Car role created via /addcar by ${interaction.user.tag}`,
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply(
        'Could not create the role. Make sure my role is above the roles I need to manage.',
      );
    }
  }

  // already has it?
  if (interaction.member.roles.cache.has(role.id)) {
    return interaction.editReply(`You already have **${carName}** on your profile.`);
  }

  // can the bot assign this role?
  if (role.position >= me.roles.highest.position) {
    return interaction.editReply(
      `I can't assign **${carName}**
  // — my highest role needs to be above that role in Server Settings → Roles.`,
    );
  }

  try {
    await interaction.member.roles.add(role, 'Added via /addcar');
  } catch (err) {
    console.error(err);
    return interaction.editReply('Failed to assign the role.');
  }

  return interaction.editReply(`This! **${carName}** was added to your profile.`);
}

async function handleRemoveCar(interaction) {
  const roleId = interaction.options.getString('car', true);
  const role = interaction.guild.roles.cache.get(roleId);

  if (!role || !isCarRole(role)) {
    return interaction.reply({
      content: 'That doesn\'t look like a car role.',
      ephemeral: true,
    });
  }

  if (!interaction.member.roles.cache.has(role.id)) {
    return interaction.reply({
      content: `You don't have **${carDisplayName(role)}** on your profile.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await interaction.member.roles.remove(role, 'Removed via /removecar');
  } catch (err) {
    console.error(err);
    return interaction.editReply('Failed to remove the role.');
  }

  // optional cleanup: delete the role if nobody else has it
  await role.guild.members.fetch().catch(() => null);
  const stillUsed = role.members.size > 0;
  if (!stillUsed) {
    try {
      await role.delete('No members left with this car role');
    } catch {
      /* ignore — not critical */
    }
  }

  return interaction.editReply(`Removed **${carDisplayName(role)}**.`);
}

async function handleMyCars(interaction) {
  const cars = interaction.member.roles.cache
    .filter(isCarRole)
    .map((r) => carDisplayName(r))
    .sort();

  if (cars.length === 0) {
    return interaction.reply({
      content: 'You haven\'t added any cars yet. Try `/addcar`.',
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${interaction.user.username}'s garage`)
    .setDescription(cars.map((c) => c).join('\n'))
    .setColor(0x2b6cb0);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleListCars(interaction) {
  const cars = interaction.guild.roles.cache
    .filter(isCarRole)
    .map((r) => ({ name: carDisplayName(r), count: r.members.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (cars.length === 0) {
    return interaction.reply({
      content: 'No car roles exist yet. Be the first — try `/addcar`.',
      ephemeral: true,
    });
  }

  const lines = cars.map((c) => `**${c.name}** — ${c.count} owner${c.count === 1 ? '' : 's'}`);
  const embed = new EmbedBuilder()
    .setTitle('Cars in this server')
    .setDescription(lines.slice(0, 50).join('\n'))
    .setColor(0x2b6cb0)
    .setFooter({
      text: cars.length > 50 ? `Showing 50 of ${cars.length}` : `${cars.length} total`,
    });

  return interaction.reply({ embeds: [embed] });
}

async function handleAutocomplete(interaction) {
  if (interaction.commandName !== 'removecar') return;
  const focused = interaction.options.getFocused().toLowerCase();

  const choices = interaction.member.roles.cache
    .filter(isCarRole)
    .map((r) => ({ name: carDisplayName(r), value: r.id }))
    .filter((c) => c.name.toLowerCase().includes(focused))
    .slice(0, 25);

  await interaction.respond(choices);
}

// ---- dispatch --------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) return handleAutocomplete(interaction);
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case 'addcar':
        return handleAddCar(interaction);
      case 'removecar':
        return handleRemoveCar(interaction);
      case 'mycars':
        return handleMyCars(interaction);
      case 'listcars':
        return handleListCars(interaction);
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied) {
      interaction.reply({ content: 'Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

// ---- boot ------------------------------------------------------------------

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
