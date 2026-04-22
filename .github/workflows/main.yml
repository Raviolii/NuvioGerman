const scraper = require('./src/providers/filmpalast.js'); 

async function runTest() {
    console.log("--- Starting Test ---");
    
    // Replace these with a real movie's TMDB ID
    // Example: 603 is 'The Matrix'
    const testId = "603"; 
    const type = "movie";

    try {
        const results = await scraper.getStreams(testId, type);
        
        if (results.length === 0) {
            console.log("❌ No results found.");
        } else {
            console.log(`✅ Success! Found ${results.length} streams:`);
            results.forEach((res, index) => {
                console.log(`\n[${index + 1}] Title: ${res.meta.title}`);
                console.log(`    URL: ${res.url}`);
            });
        }
    } catch (err) {
        console.error("❌ Test Failed with Error:", err);
    }
}

runTest();
