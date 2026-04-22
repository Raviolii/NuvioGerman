const cheerio = require('cheerio-without-node-native');

/**
 * VOE Extractor for Nuvio
 * Decodes the complex obfuscation used by voe.sx to find the .m3u8 source.
 */

// --- DECODING HELPERS ---

function shiftLetters(input) {
    return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
}

function replaceJunk(input) {
    const junkParts = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
    let result = input;
    junkParts.forEach(junk => {
        result = result.split(junk).join("_");
    });
    return result.replace(/_/g, "");
}

function shiftBack(s, n) {
    return Array.from(s)
        .map(c => String.fromCharCode(c.charCodeAt(0) - n))
        .join('');
}

function decodeVoeString(encoded) {
    try {
        // Step 1: ROT13
        let step1 = shiftLetters(encoded);
        // Step 2: Junk removal
        let step2 = replaceJunk(step1);
        // Step 3: Base64 decode
        let step3 = Buffer.from(step2, 'base64').toString('utf-8');
        // Step 4: CharCode Shift
        let step4 = shiftBack(step3, 3);
        // Step 5: Reverse and Base64 decode again
        let reversed = step4.split('').reverse().join('');
        let step5 = Buffer.from(reversed, 'base64').toString('utf-8');
        
        return JSON.parse(step5);
    } catch (e) {
        return null;
    }
}

// --- MAIN EXTRACTOR ---

async function extractVoe(url) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    };

    try {
        // First Request: Get the landing/redirect page
        const response = await fetch(url, { headers });
        const html = await response.text();

        // Find the actual video page URL (regex pattern from your Swift code)
        const pattern = /https?:\/\/[^'"<>]+/g;
        const matches = html.match(pattern);
        if (!matches || matches.length === 0) return null;

        const redirectUrl = matches[0];
        const urlObj = new URL(redirectUrl);
        
        // Prepare headers for the second request (including Referer)
        const redirectHeaders = {
            ...headers,
            'Referer': `${urlObj.protocol}//${urlObj.host}/`
        };

        // Second Request: Get the page containing the script tag
        const redirectResponse = await fetch(redirectUrl, { headers: redirectHeaders });
        const redirectHtml = await redirectResponse.text();
        const $ = cheerio.load(redirectHtml);

        // Logic 1: application/json script tag (Main Logic)
        const scriptTag = $('script[type="application/json"]').first();
        if (scriptTag.length > 0) {
            let raw = scriptTag.html().trim();
            // Equivalent to Python [2:-2] / Swift offset logic
            if (raw.length > 4) {
                const trimmed = raw.substring(2, raw.length - 2);
                const decoded = decodeVoeString(trimmed);
                if (decoded && decoded.source) {
                    return { url: decoded.source, quality: 'HD' };
                }
            }
        }

        // Fallback 1: var a168c Base64
        const a168cMatch = redirectHtml.match(/var a168c='([^']+)'/);
        if (a168cMatch) {
            const decoded = Buffer.from(a168cMatch[1], 'base64').toString('utf-8');
            const reversed = decoded.split('').reverse().join('');
            try {
                const json = JSON.parse(reversed);
                if (json.source) return { url: json.source, quality: 'HD' };
            } catch (e) {}
        }

        // Fallback 2: 'hls' Base64
        const hlsMatch = redirectHtml.match(/'hls': '([^']+)'/);
        if (hlsMatch) {
            const hlsUrl = Buffer.from(hlsMatch[1], 'base64').toString('utf-8');
            return { url: hlsUrl, quality: 'HD' };
        }

    } catch (error) {
        console.error(`[VOE Extractor] Error: ${error.message}`);
    }

    return null;
}

module.exports = { extractVoe };
