var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// High-compatibility User-Agent
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

var DEFAULT_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': BASE_URL
};

var VOE_MIRRORS = [
    'voe.sx', 'chuckle-tube.com', 'goofy-banana.com', 'smoki.cc', 'kinoger.ru', 
    'v-o-e-unblock.com', 'reputationsheriffkennethsand.com', '19turanosephantasia.com'
];

// ==========================================
// 1. VOE RESOLVER (LaMovie Logic)
// ==========================================
var voeResolver = {
    b64: function(str) {
        try {
            return Buffer.from(str, 'base64').toString('utf-8');
        } catch (e) { return null; }
    },

    decode: function(ct, luts) {
        try {
            // Clean up the Lookup Table array
            var rawLuts = luts.replace(/^\[|\]$/g, "").split("','").map(function(s) {
                return s.replace(/^'+|'+$/g, "");
            });
            var escapedLuts = rawLuts.map(function(i) {
                return i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            });

            // Step 1: Character Shifting
            var txt = "";
            for (var ci = 0; ci < ct.length; ci++) {
                var x = ct.charCodeAt(ci);
                if (x > 64 && x < 91) x = (x - 52) % 26 + 65;
                else if (x > 96 && x < 123) x = (x - 84) % 26 + 97;
                txt += String.fromCharCode(x);
            }

            // Step 2: Remove junk parts based on LUTs
            for (var pi = 0; pi < escapedLuts.length; pi++) {
                txt = txt.replace(new RegExp(escapedLuts[pi], "g"), "");
            }

            // Step 3: Base64 Decode -> Offset Shift -> Reverse -> Final Base64
            var step1 = this.b64(txt);
            if (!step1) return null;

            var step2 = "";
            for (var si = 0; si < step1.length; si++) {
                step2 += String.fromCharCode((step1.charCodeAt(si) - 3 + 256) % 256);
            }

            var revBase64 = step2.split("").reverse().join("");
            var finalStr = this.b64(revBase64);
            
            return JSON.parse(finalStr);
        } catch (e) { return null; }
    },

    resolve: async function(url) {
        try {
            var response = await fetch(url, { headers: DEFAULT_HEADERS });
            var html = await response.text();

            // Find the encoded payload and the external script containing the keys
            var rMain = html.match(/json">\s*\[s*['"]([^'"]+)['"]\s*\]\s*<\/script>\s*<script[^>]*src=['"]([^'"]+)['"]/i);
            
            if (rMain) {
                var encodedData = rMain[1];
                var loaderUrl = rMain[2].indexOf("http") === 0 ? rMain[2] : new URL(rMain[2], url).href;

                var jsData = await fetch(loaderUrl, { headers: { "Referer": url } }).then(r => r.text());
                var replMatch = jsData.match(/(\[(?:'[^']{1,10}'[\s,]*){4,12}\])/i) || 
                                jsData.match(/(\[(?:"[^"]{1,10}"[8,\s]*){4,12}\])/i);

                if (replMatch) {
                    var result = this.decode(encodedData, replMatch[1]);
                    if (result && (result.source || result.direct_access_url)) {
                        return result.source || result.direct_access_url;
                    }
                }
            }

            // Fallback: Check for older HLS Base64 tags
            var hlsMatch = html.match(/'hls':\s*'([^']+)'/);
            if (hlsMatch) return this.b64(hlsMatch[1]);

        } catch (e) { console.log("[VOE] Error: " + e.message); }
        return null;
    }
};

// ==========================================
// 2. MAIN SCRAPER
// ==========================================

async function getStreams(tmdbId, mediaType) {
    var results = [];
    console.log("[Filmpalast] Searching TMDB: " + tmdbId);

    try {
        // 1. Get IMDB ID from TMDB
        var type = mediaType === 'series' ? 'tv' : 'movie';
        var tmdbUrl = `${TMDB_BASE_URL}/${type}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
        var idData = await fetch(tmdbUrl).then(r => r.json());
        if (!idData.imdb_id) return [];

        // 2. Search Filmpalast via Autocomplete
        var searchRes = await fetch(`${BASE_URL}/autocomplete.php`, {
            method: 'POST',
            headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });
        
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) return [];

        // 3. Navigate to Stream Page
        var targetTitle = movieList.find(t => t.toLowerCase().indexOf('english') === -1) || movieList[0];
        var searchPageUrl = `${BASE_URL}/search/title/${encodeURIComponent(targetTitle)}`;
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $search = cheerio.load(searchHtml);
        
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = null;

        if (streamAnchor.length > 0) {
            var href = streamAnchor.attr('href');
            // Path cleanup: Ensure no double domains
            var cleanPath = href.replace('/filmpalast.to', '').replace(/^\/?/, '/');
            streamPageUrl = BASE_URL + cleanPath;
        } else if (searchHtml.includes('currentStreamLinks')) {
            streamPageUrl = searchPageUrl;
        }

        if (!streamPageUrl) return [];
        console.log("[Filmpalast] Extracting from: " + streamPageUrl);

        // 4. Parse Stream Links
        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref || aHref.includes('javascript')) continue;
            
            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);
            
            // Resolve VOE specifically using the new logic
            if (VOE_MIRRORS.some(m => fullUrl.includes(m))) {
                var directUrl = await voeResolver.resolve(fullUrl);
                if (directUrl) {
                    results.push({
                        url: directUrl,
                        meta: { title: "[VOE] Filmpalast", countryCodes: ['de'] }
                    });
                }
            }
        }
    } catch (e) { console.log("[Filmpalast] Error: " + e.message); }

    console.log("[Filmpalast] Total Streams Found: " + results.length);
    return results;
}

module.exports = { getStreams: getStreams };
