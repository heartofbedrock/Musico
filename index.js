require('dotenv').config();

const { Client, Intents } = require('discord.js');
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
const guildQueues = new Map();

// ------ Discord Client ------
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_VOICE_STATES,
    Intents.FLAGS.GUILD_MESSAGES
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

// ------ Helper: Resolve Track ------
async function resolveTrack(query) {
  if (/spotify\.com\/track/.test(query)) {
    const data = await spotify.clientCredentialsGrant();
    spotify.setAccessToken(data.body.access_token);
    const id = query.split('/track/')[1].split('?')[0];
    const { body: track } = await spotify.getTrack(id);

    const title = `${track.artists[0].name} - ${track.name}`;
    const search = await ytsr(`${title} audio`, { limit: 5 });
    const item = search.items.find(i => i.type === 'video');
    if (!item) throw new Error('No YouTube result found.');

    return { title, url: item.url };
  } else {
    const search = await ytsr(query, { limit: 5 });
    const item = search.items.find(i => i.type === 'video');
    if (!item) throw new Error('No YouTube result found.');

    return { title: item.title, url: item.url };
  }
}

// ------ Commands ------
client.on('messageCreate', async msg => {
  if (!msg.content.startsWith(prefix) || msg.author.bot) return;
  const guildId = msg.guild.id;
  const args = msg.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const voiceChannel = msg.member.voice.channel;

  switch (command) {
    case 'play': /* … */ break;
    /* commands abbreviated for brevity (see full index.js above) */
  }
});

client.login(process.env.DISCORD_TOKEN);