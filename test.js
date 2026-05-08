const filmpalast = require('./src/providers/FilmpalastTo.js');
const sto = require('./src/providers/STo.js'); // Assuming you named the new file STo.js

async function runTest(label, provider, id, type, season, episode) {
    console.log(`\n🚀 Testing ${label} locally...`);
    try {
        const streams = await provider.getStreams(id, type, season, episode);
        
        if (streams.length > 0) {
            console.log(`✅ SUCCESS! ${label} found ${streams.length} streams:`);
            streams.forEach((s, i) => {
                console.log(`  [${i + 1}] ${s.meta.title}`);
                console.log(`      URL: ${s.url}`);
            });
        } else {
            console.log(`❌ No streams found for ${label}. Check the IMDb/TMDB ID or site status.`);
        }
    } catch (err) {
        console.error(`💥 ${label} Scraper crashed:`, err.message);
    }
}

async function start() {
    // 1. Test Filmpalast (Movie)
    // TMDB ID 1318447
    await runTest("Filmpalast", filmpalast, 1318447, "movie");

    // 2. Test S.to (Series)
    // Using 'The Boys' IMDb ID (tt1190634) - S.to uses IMDb IDs for its search
    const theBoysImdb = "tt1190634"; 
    await runTest("S.to", sto, theBoysImdb, "series", 1, 1);
}

start();
