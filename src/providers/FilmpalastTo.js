const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ==========================================
// 1. VOE DECODER (Standard JS Syntax)
// ==========================================

const voeDecoder = {
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
        var result = "";
        for (var i = 0; i < s.length; i++) {
            result += String.fromCharCode(s.charCodeAt(i) - n);
        }
        return result;
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
        } catch (e) {
            return null;
        }
    }
};

async function extractVoe(url) {
    try {
        const response = await fetch(url, { headers: DEFAULT_HEADERS });
        const html = await response.text();
        const pattern = /https?:\/\/[^'"<>]+/g;
        const matches = html.match(pattern);
        if (!matches) return null;

        const redirectUrl = matches[0];
        const res = await fetch(redirectUrl, { 
            headers: { ...DEFAULT_HEADERS, 'Referer': new URL(redirectUrl).origin + '/' } 
        }).then(function(r) { return r.text(); });
        
        const $ = cheerio.load(res);
        const script = $('script[type="application/json"]').first().html();
        if (script && script.trim().length > 4) {
            const data = voeDecoder.decode(script.trim().substring(2, script.trim().length - 2));
            if (data && data.source) return data.source;
        }
    } catch (e) {
        console.error("VOE Error:", e.message);
    }
    return null;
}

// ==========================================
// 2. VIDARA EXTRACTOR (Standard JS Syntax)
// ==========================================

async function extractVidara(urlStr) {
    try {
        const url = new URL(urlStr);
        const filecodeMatch = url.pathname.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;
        
        const filecode = filecodeMatch[1];
        const apiUrl = url.origin + '/api/stream';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/json',
                'Referer': urlStr,
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ filecode: filecode, device: 'web' }),
        }).then(function(r) { return r.json(); });

        if (response && response.streaming_url) {
            return response.streaming_url;
        }
    } catch (e) {
        console.error("Vidara Error:", e.message);
    }
    return null;
}

// ==========================================
// 3. MAIN SCRAPER
// ==========================================

async function getImdbId(tmdbId, type) {
    const targetType = type === 'series' ? 'tv' : 'movie';
    const response = await fetch(TMDB_BASE_URL + '/' + targetType + '/' + tmdbId + '/external_ids?api_key=' + TMDB_API_KEY);
    const data = await response.json();
    return data && data.imdb_id ? data.imdb_id : null;
}

async function getStreams(tmdbId, mediaType) {
    const results = [];
    try {
        const imdbId = await getImdbId(tmdbId, mediaType || 'movie');
        if (!imdbId) return [];

        const searchRes = await fetch(BASE_URL + '/autocomplete.php', {
            method: 'POST',
            headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'term=' + encodeURIComponent(imdbId)
        });
        const movieList = await searchRes.json();
        if (!Array.isArray(movieList) || movieList.length === 0) return [];

        const filtered = movieList.find(function(t) { return !t.toLowerCase().includes('english'); }) || movieList[0];
        const searchHtml = await fetch(BASE_URL + '/search/title/' + encodeURIComponent(filtered), { headers: DEFAULT_HEADERS }).then(function(r) { return r.text(); });
        const $ = cheerio.load(searchHtml);

        var streamPageUrl = $('a[href*="filmpalast.to/stream/"]').first().attr('href');
        if (streamPageUrl) {
            streamPageUrl = streamPageUrl.startsWith('http') ? streamPageUrl : (streamPageUrl.startsWith('//') ? 'https:' + streamPageUrl : BASE_URL + streamPageUrl);
        } else if (searchHtml.includes('currentStreamLinks')) {
            streamPageUrl = BASE_URL + '/search/title/' + encodeURIComponent(filtered);
        }

        if (!streamPageUrl) return [];

        const streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(function(r) { return r.text(); });
        const $stream = cheerio.load(streamHtml);
        const links = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (var i = 0; i < links.length; i++) {
            var el = links[i];
            var href = $stream(el).attr('href');
            if (!href || href === '#' || href.includes('javascript:void')) continue;

            var fullUrl = href.startsWith('http') ? href : (href.startsWith('//') ? 'https:' + href : 'https://' + href);

            var directLink = null;
            if (fullUrl.includes('voe.sx')) {
                directLink = await extractVoe(fullUrl);
            } else if (/vidara\.(so|to)/.test(fullUrl)) {
                directLink = await extractVidara(fullUrl);
            }

            if (directLink) {
                results.push({
                    url: directLink,
                    meta: {
                        title: directLink,
                        countryCodes: ['de']
                    }
                });
            }
        }
    } catch (e) {
        console.error("Filmpalast Main Error:", e.message);
    }

    return results;
}

module.exports = { getStreams: getStreams };
