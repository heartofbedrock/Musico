require('dotenv').config();

const { Client, GatewayIntentBits, REST, Routes, AudioPlayerStatus, createAudioPlayer, createAudioResource, joinVoiceChannel } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const ytdl = require('ytdl-core');
const ytsr = require('ytsr');
const SpotifyWebApi = require('spotify-web-api-node');

// ------ Configure Spotify API ------
const spotify = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// ------ In-memory guild queues ------
// Map<guildId, { voiceChannel, textChannel, connection, player, tracks: [], current }>
const guildQueues = new Map();

// ------ Define slash commands ------
const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Add a Spotify track URL or search terms to the queue')
    .addStringOption(opt => opt.setName('query').setDescription('Spotify URL or search terms').setRequired(true)),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
  new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the current queue'),
  new SlashCommandBuilder().setName('nowplaying').setDescription('Show the track currently playing'),
].map(cmd => cmd.toJSON());

// ------ Register slash commands ------
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    console.log('⏳ Refreshing slash commands...');
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log('✅ Registered guild commands.');
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log('✅ Registered global commands.');
    }
  } catch (err) {
    console.error('❌ Error registering commands:', err);
  }
})();

// ------ Discord Client ------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once('ready', () => {
  console.log(`✔️  Logged in as ${client.user.tag}`);
});

// ------ Queue Helpers ------
function createQueue(guildId, voiceChannel, textChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });
  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on('stateChange', (_oldState, newState) => {
    if (newState.status === AudioPlayerStatus.Idle) playNext(guildId);
  });

  const queue = { voiceChannel, textChannel, connection, player, tracks: [], current: null };
  guildQueues.set(guildId, queue);
  return queue;
}

async function playNext(guildId) {
  const queue = guildQueues.get(guildId);
  if (!queue) return;

  const next = queue.tracks.shift();
  if (!next) {
    queue.connection.destroy();
    guildQueues.delete(guildId);
    return;
  }

  queue.current = next;
  const stream = ytdl(next.url, { filter: 'audioonly' });
  queue.player.play(createAudioResource(stream));
  queue.textChannel.send(`▶️ Now playing: **${next.title}**`);
}

async function resolveTrack(query) {
  if (/spotify\.com\/track/.test(query)) {
    const data = await spotify.clientCredentialsGrant();
    spotify.setAccessToken(data.body.access_token);
    const id = query.split('/track/')[1].split('?')[0];
    const { body: track } = await spotify.getTrack(id);

    const title = `${track.artists[0].name} - ${track.name}`;
    const results = await ytsr(`${title} audio`, { limit: 5 });
    const item = results.items.find(i => i.type === 'video');
    if (!item) throw new Error('No YouTube result found.');

    return { title, url: item.url };
  } else {
    const results = await ytsr(query, { limit: 5 });
    const item = results.items.find(i => i.type === 'video');
    if (!item) throw new Error('No YouTube result found.');
    return { title: item.title, url: item.url };
  }
}

// ------ Interaction Handler ------
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  const guildId = interaction.guildId;
  let queue = guildQueues.get(guildId);

  try {
    switch (commandName) {
      case 'play': {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '🔊 Join a voice channel first.', ephemeral: true });
        const query = interaction.options.getString('query');
        const track = await resolveTrack(query);

        if (!queue) queue = createQueue(guildId, voiceChannel, interaction.channel);
        queue.tracks.push(track);
        await interaction.reply({ content: `➕ Added to queue: **${track.title}**` });
        if (queue.tracks.length === 1 && !queue.current) playNext(guildId);
        break;
      }
      case 'skip': {
        if (!queue) return interaction.reply({ content: '⚠️ Nothing to skip.', ephemeral: true });
        queue.player.stop();
        await interaction.reply('⏭️ Skipped the current track.');
        break;
      }
      case 'pause': {
        if (!queue) return interaction.reply({ content: '⚠️ Nothing is playing.', ephemeral: true });
        queue.player.pause();
        await interaction.reply('⏸️ Playback paused.');
        break;
      }
      case 'resume': {
        if (!queue) return interaction.reply({ content: '⚠️ Nothing to resume.', ephemeral: true });
        queue.player.unpause();
        await interaction.reply('▶️ Playback resumed.');
        break;
      }
      case 'stop': {
        if (!queue) return interaction.reply({ content: '⚠️ Nothing is playing.', ephemeral: true });
        queue.tracks = [];
        queue.player.stop();
        queue.connection.destroy();
        guildQueues.delete(guildId);
        await interaction.reply('🛑 Stopped playback and cleared the queue.');
        break;
      }
      case 'queue': {
        if (!queue || (!queue.current && queue.tracks.length === 0))
          return interaction.reply({ content: '📭 The queue is empty.', ephemeral: true });
        const list = [];
        if (queue.current) list.push(`Now playing: **${queue.current.title}**`);
        queue.tracks.forEach((t, i) => list.push(`${i + 1}. ${t.title}`));
        await interaction.reply(list.join('\n'));
        break;
      }
      case 'nowplaying': {
        if (!queue || !queue.current)
          return interaction.reply({ content: 'ℹ️ Nothing is currently playing.', ephemeral: true });
        await interaction.reply(`▶️ Now playing: **${queue.current.title}**`);
        break;
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred)
      interaction.followUp({ content: '❌ Error executing command.', ephemeral: true });
    else
      interaction.reply({ content: '❌ Error executing command.', ephemeral: true });
  }
});

// ------ Login ------
client.login(process.env.DISCORD_TOKEN);