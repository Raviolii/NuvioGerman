// GitHub is case-sensitive! Ensure 'FilmpalastTo' matches the filename exactly.
var scraper = require('./src/providers/FilmpalastTo.js'); 

async function runTest() {
    console.log("--- Starting Test for Filmpalast ---");
    try {
        // Test with 'The Matrix' (TMDB ID: 603)
        var results = await scraper.getStreams("603", "movie");
        
        if (results && results.length > 0) {
            console.log("✅ Success! Found " + results.length + " streams.");
            results.forEach(function(res) {
                console.log(" >> " + res.meta.title);
            });
            process.exit(0);
        } else {
            console.log("❌ No streams found. (This might be an IP block by Filmpalast)");
            process.exit(1);
        }
    } catch (err) {
        console.error("❌ Test Failed with Error:", err);
        process.exit(1);
    }
}

runTest();
