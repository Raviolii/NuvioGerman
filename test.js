const filmpalast = require('./src/providers/FilmpalastTo.js');
const sto = require('./src/providers/STo.js');

async function runTest(label, provider, id, type, season, episode) {
    console.log(`\n🚀 Testing ${label} locally...`);
    try {
        // Ensure the function exists before calling
        if (!provider || typeof provider.getStreams !== 'function') {
            throw new Error(`Provider ${label} does not have a getStreams function.`);
        }

        const streams = await provider.getStreams(id, type, season, episode);
        
        if (streams && streams.length > 0) {
            console.log(`✅ SUCCESS! ${label} found ${streams.length} streams:`);
            streams.forEach((s, i) => {
                console.log(`  [${i + 1}] ${s.meta.title}`);
                console.log(`      URL: ${s.url}`);
            });
        } else {
            console.log(`❌ No streams found for ${label}. Check the ID, Type (Movie vs Series), or Site Status.`);
        }
    } catch (err) {
        console.error(`💥 ${label} Scraper crashed:`, err.message);
    }
}

async function start() {
    // ==========================================
    // 1. Test Filmpalast (Movie)
    // ID: 1022789 (Example: Inside Out 2)
    // ==========================================
    await runTest("Filmpalast", filmpalast, "1022789", "movie");

    // ==========================================
    // 2. Test S.to (Series)
    // ID: 76479 (The Boys - TMDB ID)
    // Note: The S.to script converts this to IMDb internally
    // ==========================================
    const theBoysTmdbId = "76479"; 
    await runTest("S.to", sto, theBoysTmdbId, "series", 1, 1);
}

start();
