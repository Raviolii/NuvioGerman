const filmpalast = require('./src/providers/FilmpalastTo.js');
const sto = require('./src/providers/STo.js');
const ohato = require('./src/providers/OhaTo.js');

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
                // Safeguard property extraction so it handles flat properties or meta objects cleanly
                const displayTitle = s.title || (s.meta && s.meta.title) || s.name || 'Unknown Hoster';
                console.log(`  [${i + 1}] ${displayTitle}`);
                console.log(`      URL: ${s.url || 'No URL available'}`);
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
    // ID: 931285 (Example: Inside Out 2)
    // ==========================================
    await runTest("Filmpalast", filmpalast, "931285", "movie");

    // ==========================================
    // 1b. Test Filmpalast (Series)
    // ID: 94997 - Season 1 Episode 1
    // ==========================================
    await runTest("Filmpalast (Series)", filmpalast, "94997", "series", 2, 1);

    // ==========================================
    // 2. Test S.to (Series) - using TMDB id 931285 for consistency
    // ==========================================
    const theBoysTmdbId = "931285";
    await runTest("S.to", sto, theBoysTmdbId, "series", 3, 1);

    // ==========================================
    // 3. Test Oha.to (Movie & Series)
    // Uses TMDB IDs directly
    // ==========================================
    console.log("\n--- Running Oha.to Tests ---");
    // Test Oha.to with a Movie (Inside Out 2)
    await runTest("Oha.to (Movie)", ohato, "931285", "movie");
    
    // Test Oha.to with a Series (The Boys Season 1 Episode 1)
    await runTest("Oha.to (Series)", ohato, "76479", "series", 1, 1);
}

start();
