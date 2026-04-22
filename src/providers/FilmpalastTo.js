var cheerio = require('cheerio-without-node-native');



var BASE_URL = 'https://filmpalast.to';

var TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';

var TMDB_BASE_URL = 'https://api.themoviedb.org/3';



// High-compatibility User-Agent

var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36';



var DEFAULT_HEADERS = {

    'User-Agent': UA,

    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',

    'Referer': BASE_URL

};



// Mirror domains from the VOE SDK

var VOE_MIRRORS = [

    'voe.sx', 'chuckle-tube.com', 'goofy-banana.com', 'smoki.cc', 'kinoger.ru', 

    'v-o-e-unblock.com', 'reputationsheriffkennethsand.com', '19turanosephantasia.com'

];



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

            return JSON.parse(s5);

        } catch (e) { return null; }

    }

};



// ==========================================

// 2. EXTRACTORS

// ==========================================



async function extractVoe(urlStr) {

    try {

        console.log("[VOE] Initiating extraction for: " + urlStr);

        var urlObj = new URL(urlStr);

        

        // Step 1: Landing Page Fetch

        var response = await fetch(urlStr, { headers: DEFAULT_HEADERS });

        var html = await response.text();

        

        // Check for JS Redirects (window.location.href)

        var redirectMatch = html.match(/window\.location\.href\s*=\s*'([^']+)/);

        var redirectUrl = redirectMatch ? redirectMatch[1] : null;



        if (!redirectUrl) {

            var pattern = /https?:\/\/[^'"<>]+/g;

            var matches = html.match(pattern);

            if (matches) redirectUrl = matches[0];

        }



        if (!redirectUrl) redirectUrl = urlStr;



        // Construct headers with Swift-style Referer

        var parts = redirectUrl.split("/");

        var customHeaders = Object.assign({}, DEFAULT_HEADERS);

        if (parts.length > 2) {

            customHeaders["Referer"] = parts[0] + "//" + parts[2] + "/";

        }



        console.log("[VOE] Fetching Player with Referer: " + customHeaders["Referer"]);

        var redirectRes = await fetch(redirectUrl, { headers: customHeaders });

        var redirectHtml = await redirectRes.text();



        // METHOD 1: application/json script tag

        var $ = cheerio.load(redirectHtml);

        var script = $('script[type="application/json"]').first().html();

        if (script && script.trim().length > 4) {

            var trimmed = script.trim();

            var decoded = voeDecoder.decode(trimmed.substring(2, trimmed.length - 2));

            if (decoded && decoded.source) {

                console.log("[VOE] Success: Method 1");

                return decoded.source;

            }

        }



        // METHOD 2: var a168c (Base64 + Reversed)

        var a168Match = redirectHtml.match(/var a168c='([^']+)'/);

        if (a168Match) {

            var decodedStr = Buffer.from(a168Match[1], 'base64').toString('utf-8');

            var reversed = decodedStr.split('').reverse().join('');

            var jsonObject = JSON.parse(reversed);

            if (jsonObject && jsonObject.source) {

                console.log("[VOE] Success: Method 2");

                return jsonObject.source;

            }

        }



        // METHOD 3: 'hls' key in HTML

        var hlsMatch = redirectHtml.match(/'hls': '([^']+)'/);

        if (hlsMatch) {

            var hlsString = Buffer.from(hlsMatch[1], 'base64').toString('utf-8');

            console.log("[VOE] Success: Method 3");

            return hlsString;

        }



        console.log("[VOE] FAILED: All methods exhausted.");

    } catch (e) { console.log("[VOE] Error: " + e.message); }

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

                'User-Agent': UA,

                'Content-Type': 'application/json',

                'Referer': urlStr,

                'X-Requested-With': 'XMLHttpRequest'

            },

            body: JSON.stringify({ filecode: filecodeMatch[1], device: 'web' })

        });

        var data = await response.json();

        if (data && data.streaming_url) {

            console.log("[Vidara] Success");

            return data.streaming_url;

        }

    } catch (e) { console.log("[Vidara] Error: " + e.message); }

    return null;

}



// ==========================================

// 3. MAIN SCRAPER

// ==========================================



async function getStreams(tmdbId, mediaType) {

    var results = [];

    console.log("[Filmpalast] START: Processing " + tmdbId);



    try {

        var type = mediaType || 'movie';

        var tmdbUrl = TMDB_BASE_URL + '/' + (type === 'series' ? 'tv' : 'movie') + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY;

        var idData = await fetch(tmdbUrl).then(r => r.json());

        if (!idData.imdb_id) return [];



        var searchRes = await fetch(BASE_URL + '/autocomplete.php', {

            method: 'POST',

            headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },

            body: 'term=' + encodeURIComponent(idData.imdb_id)

        });

        

        var movieList = await searchRes.json();

        if (!movieList || movieList.length === 0) return [];



        var targetTitle = movieList.find(t => t.toLowerCase().indexOf('english') === -1) || movieList[0];

        var searchPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(targetTitle);

        var searchHtml = await fetch(searchPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());

        var $search = cheerio.load(searchHtml);

        

        var streamAnchor = $search('a[href*="/stream/"]').first();

        var streamPageUrl = null;



        if (streamAnchor.length > 0) {

            var href = streamAnchor.attr('href');

            // Path cleaner to fix double domain error

            var cleanPath = href.replace('/filmpalast.to', '');

            if (cleanPath.indexOf('/') !== 0) cleanPath = '/' + cleanPath;

            streamPageUrl = BASE_URL + cleanPath;

        } else if (searchHtml.includes('currentStreamLinks')) {

            streamPageUrl = searchPageUrl;

        }



        if (!streamPageUrl) return [];

        console.log("[Filmpalast] Final Stream Page: " + streamPageUrl);



        var streamPageHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());

        var $stream = cheerio.load(streamPageHtml);

        var anchors = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();



        for (var i = 0; i < anchors.length; i++) {

            var aHref = $stream(anchors[i]).attr('href');

            if (!aHref || aHref.indexOf('javascript') !== -1) continue;

            

            var fullUrl = aHref.indexOf('//') === 0 ? 'https:' + aHref : (aHref.indexOf('http') === 0 ? aHref : 'https://' + aHref);

            var direct = null;

            var label = "Stream";



            // Check against mirror domain list

            var isVoe = VOE_MIRRORS.some(m => fullUrl.includes(m));



            if (isVoe) {

                direct = await extractVoe(fullUrl);

                label = "VOE";

            } else if (fullUrl.indexOf('vidara.') !== -1) {

                direct = await extractVidara(fullUrl);

                label = "Vidara";

            }



            if (direct) {

                results.push({

                    url: direct,

                    meta: { 

                        title: "[" + label + "] Filmpalast", 

                        countryCodes: ['de'] 

                    }

                });

            }

        }

    } catch (e) { console.log("[Filmpalast] Error: " + e.message); }



    console.log("[Filmpalast] COMPLETED. Found " + results.length + " results.");

    return results;

}



module.exports = { getStreams: getStreams };
