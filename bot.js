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
const CAR_ROLE_PREFIX = '​';

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

// ---- car type classification ------------------------------------------------

// Maps make name → region type. Keys are Title Case for readability;
// lookup is case-insensitive. Add entries here to expand coverage.
const MAKE_TYPE_MAP = {
  // JDM — Japanese
  Toyota: 'JDM', Honda: 'JDM', Nissan: 'JDM', Mazda: 'JDM', Subaru: 'JDM',
  Mitsubishi: 'JDM', Lexus: 'JDM', Acura: 'JDM', Infiniti: 'JDM',
  Suzuki: 'JDM', Isuzu: 'JDM', Daihatsu: 'JDM', Scion: 'JDM',

  // Euro — European
  BMW: 'Euro', Mercedes: 'Euro', 'Mercedes-Benz': 'Euro', Audi: 'Euro',
  Volkswagen: 'Euro', VW: 'Euro', Porsche: 'Euro', Ferrari: 'Euro',
  Lamborghini: 'Euro', Bugatti: 'Euro', Maserati: 'Euro', 'Alfa Romeo': 'Euro',
  Fiat: 'Euro', Peugeot: 'Euro', Renault: 'Euro', Citroen: 'Euro', Citroën: 'Euro',
  Volvo: 'Euro', Saab: 'Euro', SEAT: 'Euro', Skoda: 'Euro', Bentley: 'Euro',
  'Rolls-Royce': 'Euro', 'Aston Martin': 'Euro', Jaguar: 'Euro',
  'Land Rover': 'Euro', Mini: 'Euro', McLaren: 'Euro', Lotus: 'Euro',
  Opel: 'Euro', Vauxhall: 'Euro', Lancia: 'Euro',

  // American
  Ford: 'American', Chevrolet: 'American', Chevy: 'American', Dodge: 'American',
  Jeep: 'American', Chrysler: 'American', Cadillac: 'American', Buick: 'American',
  GMC: 'American', Lincoln: 'American', Pontiac: 'American', Oldsmobile: 'American',
  Plymouth: 'American', Tesla: 'American', Mercury: 'American', Hummer: 'American',
  Ram: 'American', Shelby: 'American', Studebaker: 'American', Packard: 'American',
};

// Pre-computed lowercase lookup for fast, case-insensitive matching
const MAKE_TYPE_LOWER = Object.fromEntries(
  Object.entries(MAKE_TYPE_MAP).map(([k, v]) => [k.toLowerCase(), v]),
);

// Role color per type
const TYPE_COLORS = {
  JDM:      0xED4245, // red
  American: 0xFF9533, // orange
  Euro:     0x3B82F6, // blue
  Other:    0x95A5A6, // gray
};

const getCarType = (make) => MAKE_TYPE_LOWER[make.toLowerCase().trim()] ?? 'Other';

// Parse a display name back into { make, model, year, transmission }
const parseCarName = (displayName) => {
  const transMatch = displayName.match(/\[(.+?)\]$/);
  const transmission = transMatch ? transMatch[1] : null;
  const withoutTrans = transMatch ? displayName.slice(0, transMatch.index).trim() : displayName;
  const yearMatch = withoutTrans.match(/\((\d{4})\)$/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;
  const makeModel = yearMatch ? withoutTrans.slice(0, yearMatch.index).trim() : withoutTrans;
  const parts = makeModel.split(' ');
  return { make: parts[0] ?? null, model: parts.slice(1).join(' ') || null, year, transmission };
};

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
    .setDescription('List every car role in this server')
    .addStringOption((o) =>
      o.setName('make').setDescription('Filter by manufacturer, e.g. Toyota').setMaxLength(40),
    )
    .addStringOption((o) =>
      o.setName('transmission').setDescription('Filter by transmission, e.g. MT or AT').setMaxLength(30),
    )
    .addStringOption((o) =>
      o.setName('type').setDescription('Filter by region type: JDM, Euro, American, Other').setMaxLength(20),
    ),

  new SlashCommandBuilder()
    .setName('whohas')
    .setDescription('See who owns a specific car')
    .addStringOption((o) =>
      o
        .setName('car')
        .setDescription('Which car to look up')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  new SlashCommandBuilder()
    .setName('cleanupcars')
    .setDescription('Delete all car roles that nobody owns')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
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

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({
      content: 'I need the **Manage Roles** permission to do that.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  let role = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === roleName.toLowerCase(),
  );

  if (!role) {
    try {
      role = await guild.roles.create({
        name: roleName,
        color: TYPE_COLORS[getCarType(make)],
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

  if (interaction.member.roles.cache.has(role.id)) {
    return interaction.editReply(`You already have **${carName}** on your profile.`);
  }

  if (role.position >= me.roles.highest.position) {
    return interaction.editReply(
      `I can't assign **${carName}** — my highest role needs to be above that role in Server Settings → Roles.`,
    );
  }

  try {
    await interaction.member.roles.add(role, 'Added via /addcar');
  } catch (err) {
    console.error(err);
    return interaction.editReply('Failed to assign the role.');
  }

  return interaction.editReply(`**${carName}** was added to your profile.`);
}

async function handleRemoveCar(interaction) {
  const roleId = interaction.options.getString('car', true);
  const role = interaction.guild.roles.cache.get(roleId);

  if (!role || !isCarRole(role)) {
    return interaction.reply({
      content: "That doesn't look like a car role.",
      ephemeral: true,
    });
  }

  const displayName = carDisplayName(role);

  if (!interaction.member.roles.cache.has(role.id)) {
    return interaction.reply({
      content: `You don't have **${displayName}** on your profile.`,
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

  // cleanup: delete the role if nobody else has it
  let roleDeleted = false;
  await role.guild.members.fetch().catch(() => null);
  if (role.members.size === 0) {
    try {
      await role.delete('No members left with this car role');
      roleDeleted = true;
    } catch {
      // not critical if this fails
    }
  }

  const suffix = roleDeleted ? '\n-# Role deleted — you were the last owner.' : '';
  return interaction.editReply(`Removed **${displayName}**.${suffix}`);
}

async function handleMyCars(interaction) {
  const cars = interaction.member.roles.cache
    .filter(isCarRole)
    .map((r) => carDisplayName(r))
    .sort();

  if (cars.length === 0) {
    return interaction.reply({
      content: "You haven't added any cars yet. Try `/addcar`.",
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`${interaction.user.username}'s garage`)
    .setDescription(cars.join('\n'))
    .setColor(0x2b6cb0);

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleListCars(interaction) {
  const filterMake = interaction.options.getString('make')?.toLowerCase().trim();
  const filterTrans = interaction.options.getString('transmission')?.toLowerCase().trim();
  const filterType = interaction.options.getString('type')?.trim();

  let cars = interaction.guild.roles.cache
    .filter(isCarRole)
    .map((r) => {
      const name = carDisplayName(r);
      const parsed = parseCarName(name);
      return { name, count: r.members.size, type: getCarType(parsed.make ?? ''), ...parsed };
    });

  if (filterMake) cars = cars.filter((c) => c.make?.toLowerCase().includes(filterMake));
  if (filterTrans) cars = cars.filter((c) => c.transmission?.toLowerCase().includes(filterTrans));
  if (filterType) cars = cars.filter((c) => c.type.toLowerCase() === filterType.toLowerCase());

  cars.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const hasFilter = filterMake || filterTrans || filterType;

  if (cars.length === 0) {
    return interaction.reply({
      content: hasFilter
        ? 'No cars match those filters.'
        : 'No car roles exist yet. Be the first — try `/addcar`.',
      ephemeral: true,
    });
  }

  const activeFilters = [
    filterMake && `make: **${filterMake}**`,
    filterTrans && `transmission: **${filterTrans}**`,
    filterType && `type: **${filterType}**`,
  ]
    .filter(Boolean)
    .join(', ');

  const lines = cars.map((c) => `**${c.name}** — ${c.count} owner${c.count === 1 ? '' : 's'}`);
  const embed = new EmbedBuilder()
    .setTitle(activeFilters ? `Cars matching ${activeFilters}` : 'Cars in this server')
    .setDescription(lines.slice(0, 50).join('\n'))
    .setColor(0x2b6cb0)
    .setFooter({
      text: cars.length > 50 ? `Showing 50 of ${cars.length}` : `${cars.length} total`,
    });

  return interaction.reply({ embeds: [embed] });
}

async function handleWhoHas(interaction) {
  const roleId = interaction.options.getString('car', true);
  const role = interaction.guild.roles.cache.get(roleId);

  if (!role || !isCarRole(role)) {
    return interaction.reply({ content: "That doesn't look like a car role.", ephemeral: true });
  }

  await interaction.guild.members.fetch().catch(() => null);
  const owners = role.members.map((m) => m.toString()).sort();

  if (owners.length === 0) {
    return interaction.reply({
      content: `Nobody currently owns **${carDisplayName(role)}**.`,
      ephemeral: true,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Owners of ${carDisplayName(role)}`)
    .setDescription(owners.slice(0, 50).join('\n'))
    .setColor(0x2b6cb0)
    .setFooter({ text: `${owners.length} owner${owners.length === 1 ? '' : 's'}` });

  return interaction.reply({ embeds: [embed] });
}

async function handleCleanupCars(interaction) {
  const me = interaction.guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return interaction.reply({
      content: 'I need the **Manage Roles** permission.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  await interaction.guild.members.fetch().catch(() => null);

  const empty = interaction.guild.roles.cache.filter(
    (r) => isCarRole(r) && r.members.size === 0,
  );

  if (empty.size === 0) {
    return interaction.editReply('No empty car roles to clean up — all roles have at least one owner.');
  }

  let deleted = 0;
  for (const [, role] of empty) {
    try {
      await role.delete(`Cleanup via /cleanupcars by ${interaction.user.tag}`);
      deleted++;
    } catch {
      // skip roles we can't delete
    }
  }

  return interaction.editReply(
    `Deleted **${deleted}** empty car role${deleted === 1 ? '' : 's'}.` +
      (deleted < empty.size ? ` (${empty.size - deleted} could not be deleted — check role hierarchy)` : ''),
  );
}

async function handleAutocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  if (interaction.commandName === 'removecar') {
    const choices = interaction.member.roles.cache
      .filter(isCarRole)
      .map((r) => ({ name: carDisplayName(r), value: r.id }))
      .filter((c) => c.name.toLowerCase().includes(focused))
      .slice(0, 25);
    return interaction.respond(choices);
  }

  if (interaction.commandName === 'whohas') {
    const choices = interaction.guild.roles.cache
      .filter((r) => isCarRole(r) && carDisplayName(r).toLowerCase().includes(focused))
      .map((r) => ({ name: carDisplayName(r), value: r.id }))
      .slice(0, 25);
    return interaction.respond(choices);
  }
}

// ---- dispatch --------------------------------------------------------------

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) return handleAutocomplete(interaction);
    if (!interaction.isChatInputCommand()) return;

    switch (interaction.commandName) {
      case 'addcar':      return handleAddCar(interaction);
      case 'removecar':   return handleRemoveCar(interaction);
      case 'mycars':      return handleMyCars(interaction);
      case 'listcars':    return handleListCars(interaction);
      case 'whohas':      return handleWhoHas(interaction);
      case 'cleanupcars': return handleCleanupCars(interaction);
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
