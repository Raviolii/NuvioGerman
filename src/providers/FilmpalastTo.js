var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://filmpalast.to';
var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ==========================================
// 1. VOE DECODER
// ==========================================
var voeDecoder = {
    shiftLetters: function(input) {
        return input.replace(/[a-zA-Z]/g, function(c) {
            var base = c <= 'Z' ? 65 : 97;
            return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
        });
    },
    replaceJunk: function(input) {
        var junkParts = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"];
        var result = input;
        for (var i = 0; i < junkParts.length; i++) {
            result = result.split(junkParts[i]).join("_");
        }
        return result.replace(/_/g, "");
    },
    shiftBack: function(s, n) {
        var res = "";
        for (var i = 0; i < s.length; i++) { res += String.fromCharCode(s.charCodeAt(i) - n); }
        return res;
    },
    decode: function(encoded) {
        try {
            var s1 = this.shiftLetters(encoded);
            var s2 = this.replaceJunk(s1);
            var s3 = Buffer.from(s2, 'base64').toString('utf-8');
            var s4 = this.shiftBack(s3, 3);
            var reversed = s4.split('').reverse().join('');
            var s5 = Buffer.from(reversed, 'base64').toString('utf-8');
            console.log("[VOE DEBUG] Final Decoded String: " + s5.substring(0, 100) + "...");
            return JSON.parse(s5);
        } catch (e) { 
            console.log("[VOE DEBUG] Decoder failed at step: " + e.message);
            return null; 
        }
    }
};

// ==========================================
// 2. EXTRACTORS
// ==========================================
async function extractVoe(url) {
    try {
        console.log("[VOE] STEP 1: Fetching Embed Page -> " + url);
        var response = await fetch(url, { headers: DEFAULT_HEADERS });
        var html = await response.text();
        
        // Find the "engine" or redirect link
        var matches = html.match(/https?:\/\/[^'"<>]+/g);
        if (!matches) {
            console.log("[VOE] FAILED: No URL matches found in initial HTML.");
            return null;
        }

        var redirectUrl = matches[0];
        console.log("[VOE] STEP 2: Fetching Redirect/Player URL -> " + redirectUrl);
        
        var redirectRes = await fetch(redirectUrl, { 
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Referer': redirectUrl } 
        });
        var resHtml = await redirectRes.text();
        var $ = cheerio.load(resHtml);
        
        // VOE usually stores data in a script tag as a base64-ish encoded JSON
        var scriptTag = $('script[type="application/json"]').first();
        var scriptContent = scriptTag.html();

        if (scriptContent && scriptContent.trim().length > 10) {
            console.log("[VOE] STEP 3: Found script tag. Content Length: " + scriptContent.length);
            var trimmed = scriptContent.trim();
            // Remove the outer quotes if present
            var cleanPayload = trimmed.substring(2, trimmed.length - 2);
            
            var decoded = voeDecoder.decode(cleanPayload);
            if (decoded && decoded.source) {
                console.log("[VOE] SUCCESS: Source found -> " + decoded.source);
                return decoded.source;
            } else {
                console.log("[VOE] FAILED: Decoded object does not contain 'source'. Keys found: " + Object.keys(decoded || {}));
            }
        } else {
            console.log("[VOE] FAILED: Script tag empty or not found. HTML Preview: " + resHtml.substring(0, 300).replace(/\s+/g, ' '));
        }
    } catch (e) { 
        console.log("[VOE] EXCEPTION: " + e.message); 
    }
    return null;
}

async function extractVidara(urlStr) {
    try {
        console.log("[Vidara] Fetching: " + urlStr);
        var filecodeMatch = urlStr.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;
        var apiBase = urlStr.split('/')[0] + '//' + urlStr.split('/')[2];
        var response = await fetch(apiBase + '/api/stream', {
            method: 'POST',
            headers: {
                'User-Agent': DEFAULT_HEADERS['User-Agent'],
                'Content-Type': 'application/json',
                'Referer': urlStr,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify({ filecode: filecodeMatch[1], device: 'web' })
        });
        var data = await response.json();
        return data && data.streaming_url ? data.streaming_url : null;
    } catch (e) { console.log("[Vidara] Error: " + e.message); }
    return null;
}

// ==========================================
// 3. MAIN SCRAPER
// ==========================================
async function getStreams(tmdbId, mediaType) {
    var results = [];
    console.log("[Filmpalast] START: Searching for ID " + tmdbId);
    
    try {
        var tmdbUrl = TMDB_BASE_URL + '/' + (mediaType === 'series' ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;
        var idData = await fetch(tmdbUrl).then(function(r) { return r.json(); });
        if (!idData.imdb_id) return [];

        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(idData.imdb_id)
        });
        
        var movieList = await searchRes.json();
        if (!movieList || movieList.length === 0) return [];
        
        var targetTitle = movieList.find(function(t) { return t.toLowerCase().indexOf('english') === -1; }) || movieList[0];
        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);
        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(function(r) { return r.text(); });
        var $search = cheerio.load(searchHtml);
        
        var streamAnchor = $search('a[href*="/stream/"]').first();
        var streamPageUrl = null;

        if (streamAnchor.length > 0) {
            var href = streamAnchor.attr('href');
            var cleanPath = href.replace('/filmpalast.to', '');
            if (cleanPath.indexOf('/') !== 0) cleanPath = '/' + cleanPath;
            streamPageUrl = BASE_URL + cleanPath;
        } else if (searchHtml.indexOf('currentStreamLinks') !== -1) {
            streamPageUrl = searchPageUrl;
        }

        if (!streamPageUrl) return [];
        console.log("[Filmpalast] FOUND Stream Page: " + streamPageUrl);

        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(function(r) { return r.text(); });
        var $stream = cheerio.load(streamPageHtml);
        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var i = 0; i < anchors.length; i++) {
            var aHref = $stream(anchors[i]).attr('href');
            if (!aHref || aHref.indexOf('javascript') !== -1) continue;
            
            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);
            
            if (fullUrl.indexOf('voe.sx') !== -1) {
                var direct = await extractVoe(fullUrl);
                if (direct) {
                    results.push({ url: direct, meta: { title: "[VOE] Filmpalast", countryCodes: ['de'] } });
                }
            } else if (fullUrl.indexOf('vidara.') !== -1) {
                var direct = await extractVidara(fullUrl);
                if (direct) {
                    results.push({ url: direct, meta: { title: "[Vidara] Filmpalast", countryCodes: ['de'] } });
                }
            }
        }
    } catch (e) { console.log("[Filmpalast] ERROR: " + e.message); }

    console.log("[Filmpalast] FINISHED. Found " + results.length + " streams.");
    return results;
}

module.exports = { getStreams: getStreams };
