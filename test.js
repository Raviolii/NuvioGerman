const { getStreams } = require('./src/providers/hianime.js');

getStreams('95479', 'tv',2,17).then(streams => {
  console.log('Found', streams.length, 'streams');
  streams.forEach(stream => console.log(`${stream.name}: ${stream.quality} - ${stream.url}`));
}).catch(console.error);