const provider = require('./src/providers/FilmpalastTo.js');

async function startTest() {
    console.log("🚀 Testing Filmpalast locally...");
    
    // Test with 'Der Super Mario Galaxy Film' (1226863) or 'Interstellar' (157336)
    const tmdbId = 1226863
    const type = "movie";

    try {
        const streams = await provider.getStreams(tmdbId, type);
        
        if (streams.length > 0) {
            console.log(`✅ SUCCESS! Found ${streams.length} streams:`);
            streams.forEach((s, i) => {
                console.log(`  [${i + 1}] ${s.meta.title}`);
                console.log(`      URL: ${s.url}\n`);
            });
        } else {
            console.log("❌ No streams found. Check if the site changed or if you're being blocked.");
        }
    } catch (err) {
        console.error("💥 Scraper crashed:", err);
    }
}

startTest();
