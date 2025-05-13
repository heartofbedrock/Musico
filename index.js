require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus
} = require('@discordjs/voice');
const ytdl = require('ytdl-core');
const ytsr = require('ytsr');
const SpotifyWebApi = require('spotify-web-api-node');

// ------ Configure Spotify API ------
const spotify = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// ------ Guild Queues ------
const guildQueues = new Map(); // guildId => { voiceChannel, connection, player, tracks: [], current }

// ------ Discord Client ------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

const prefix = '/';

client.once('ready', () => {
  console.log(`✔️  Logged in as ${client.user.tag}`);
});

// ------ Helper: Connect & Create Player ------
function createQueue(guildId, voiceChannel) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on('stateChange', (_oldState, newState) => {
    if (newState.status === AudioPlayerStatus.Idle) {
      playNext(guildId);
    }
  });

  const queue = { voiceChannel, connection, player, tracks: [], current: null };
  guildQueues.set(guildId, queue);
  return queue;
}

// ------ Helper: Play Next Track ------
async function playNext(guildId) {
  const queue = guildQueues.get(guildId);
  if (!queue) return;

  const nextTrack = queue.tracks.shift();
  if (!nextTrack) {
    queue.connection.destroy();
    guildQueues.delete(guildId);
    return;
  }

  queue.current = nextTrack;
  const stream = ytdl(nextTrack.url, { filter: 'audioonly' });
  const resource = createAudioResource(stream);
  queue.player.play(resource);
  queue.voiceChannel.send(`▶️ Now playing: **${nextTrack.title}**`);
}

// ------ Helper: Resolve Track (Spotify or YouTube) ------
async function resolveTrack(query) {
  if (/spotify\.com\/track/.test(query)) {
    const data = await spotify.clientCredentialsGrant();
    spotify.setAccessToken(data.body.access_token);
    const id = query.split('/track/')[1].split('?')[0];
    const { body: track } = await spotify.getTrack(id);

    const title = `${track.artists[0].name} - ${track.name}`;
    const search = await ytsr(`${title} audio`, { limit: 5 });
    const item = search.items.find(i => i.type === 'video');
    if (!item) throw new Error('No YouTube result found for Spotify track.');

    return { title, url: item.url };
  } else {
    const search = await ytsr(query, { limit: 5 });
    const item = search.items.find(i => i.type === 'video');
    if (!item) throw new Error('No YouTube result found.');

    return { title: item.title, url: item.url };
  }
}

// ------ Command Handler ------
client.on('messageCreate', async msg => {
  if (!msg.content.startsWith(prefix) || msg.author.bot) return;
  const guildId = msg.guild.id;
  const args = msg.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const voiceChannel = msg.member.voice.channel;

  switch (command) {
    case 'play': {
      if (!voiceChannel) return msg.reply('🔊 Join a voice channel first.');
      try {
        const track = await resolveTrack(args.join(' '));
        let queue = guildQueues.get(guildId);
        if (!queue) queue = createQueue(guildId, voiceChannel);
        queue.tracks.push(track);
        msg.reply(`➕ Added to queue: **${track.title}**`);
        if (queue.tracks.length === 1 && !queue.current) playNext(guildId);
      } catch (err) {
        console.error(err);
        msg.reply('❌ Unable to add that track.');
      }
      break;
    }
    case 'skip': {
      const queue = guildQueues.get(guildId);
      if (!queue) return msg.reply('⚠️ Nothing to skip.');
      queue.player.stop();
      msg.reply('⏭️ Skipped the current track.');
      break;
    }
    case 'pause': {
      const queue = guildQueues.get(guildId);
      if (!queue) return msg.reply('⚠️ Nothing is playing.');
      queue.player.pause();
      msg.reply('� paused playback.');
      break;
    }
    case 'resume': {
      const queue = guildQueues.get(guildId);
      if (!queue) return msg.reply('⚠️ Nothing to resume.');
      queue.player.unpause();
      msg.reply('▶️ Playback resumed.');
      break;
    }
    case 'stop': {
      const queue = guildQueues.get(guildId);
      if (!queue) return msg.reply('⚠️ Nothing is playing.');
      queue.tracks = [];
      queue.player.stop();
      queue.connection.destroy();
      guildQueues.delete(guildId);
      msg.reply('🛑 Stopped playback and cleared the queue.');
      break;
    }
    case 'queue': {
      const queue = guildQueues.get(guildId);
      if (!queue || (!queue.current && queue.tracks.length === 0))
        return msg.reply('📭 The queue is empty.');
      const lines = [];
      if (queue.current) lines.push(`Now playing: **${queue.current.title}**`);
      queue.tracks.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
      msg.reply(lines.join('\n'));
      break;
    }
    case 'nowplaying':
    case 'np': {
      const queue = guildQueues.get(guildId);
      if (!queue || !queue.current)
        return msg.reply('ℹ️ Nothing is currently playing.');
      msg.reply(`▶️ Now playing: **${queue.current.title}**`);
      break;
    }
  }
});

// ------ Login ------
client.login(process.env.DISCORD_TOKEN);