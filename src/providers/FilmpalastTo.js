const cheerio = require('cheerio-without-node-native');

const BASE_URL = 'https://filmpalast.to';
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': BASE_URL
};

// ==========================================
// 1. VOE EXTRACTOR LOGIC
// ==========================================

const voeDecoder = {
    shiftLetters: (i) => i.replace(/[a-zA-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - (c <= 'Z' ? 65 : 97) + 13) % 26) + (c <= 'Z' ? 65 : 97))),
    replaceJunk: (i) => ["@$", "^^", "~@", "%?", "*~", "!!", "#&"].reduce((a, b) => a.split(b).join("_"), i).replace(/_/g, ""),
    shiftBack: (s, n) => Array.from(s).map(c => String.fromCharCode(c.charCodeAt(0) - n)).join(''),
    decode(encoded) {
        try {
            let s1 = this.shiftLetters(encoded);
            let s2 = this.replaceJunk(s1);
            let s3 = Buffer.from(s2, 'base64').toString('utf-8');
            let s4 = this.shiftBack(s3, 3);
            let s5 = Buffer.from(s4.split('').reverse().join(''), 'base64').toString('utf-8');
            return JSON.parse(s5);
        } catch (e) { return null; }
    }
};

async function extractVoe(url) {
    try {
        const html = await fetch(url, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const match = html.match(/https?:\/\/[^'"<>]+/g);
        if (!match) return null;

        const redirectUrl = match[0];
        const res = await fetch(redirectUrl, { headers: { ...DEFAULT_HEADERS, 'Referer': new URL(redirectUrl).origin + '/' } }).then(r => r.text());
        const $ = cheerio.load(res);

        const script = $('script[type="application/json"]').first().html();
        if (script && script.trim().length > 4) {
            const data = voeDecoder.decode(script.trim().substring(2, script.trim().length - 2));
            if (data?.source) return data.source;
        }
    } catch (e) { console.error("[VOE Error]", e.message); }
    return null;
}

// ==========================================
// 2. VIDARA EXTRACTOR LOGIC
// ==========================================

async function extractVidara(urlStr) {
    try {
        const url = new URL(urlStr);
        const html = await fetch(urlStr, { headers: DEFAULT_HEADERS }).then(r => r.text());
        
        const filecodeMatch = url.pathname.match(/\/(?:e|v|f)\/([a-zA-Z0-9]+)/);
        if (!filecodeMatch) return null;
        
        const filecode = filecodeMatch[1];
        const apiUrl = `${url.origin}/api/stream`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/json',
                'Referer': urlStr,
                'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify({ filecode, device: 'web' }),
        }).then(r => r.json());

        if (response?.streaming_url) {
            return response.streaming_url;
        }
    } catch (e) { console.error("[Vidara Error]", e.message); }
    return null;
}

// ==========================================
// 3. MAIN SCRAPER
// ==========================================

async function getImdbId(tmdbId, type) {
    const targetType = type === 'series' ? 'tv' : 'movie';
    const data = await fetch(`${TMDB_BASE_URL}/${targetType}/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`).then(r => r.json());
    return data?.imdb_id || null;
}

async function getStreams(tmdbId, mediaType = 'movie') {
    const results = [];
    try {
        const imdbId = await getImdbId(tmdbId, mediaType);
        if (!imdbId) return [];

        const searchRes = await fetch(`${BASE_URL}/autocomplete.php`, {
            method: 'POST',
            headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `term=${encodeURIComponent(imdbId)}`
        });
        const movieList = await searchRes.json();
        if (!Array.isArray(movieList) || movieList.length === 0) return [];

        const filtered = movieList.find(t => !t.toLowerCase().includes('english')) || movieList[0];
        const html = await fetch(`${BASE_URL}/search/title/${encodeURIComponent(filtered)}`, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $ = cheerio.load(html);

        let streamPageUrl = $('a[href*="filmpalast.to/stream/"]').first().attr('href');
        if (streamPageUrl) {
            streamPageUrl = streamPageUrl.startsWith('http') ? streamPageUrl : (streamPageUrl.startsWith('//') ? `https:${streamPageUrl}` : `${BASE_URL}${streamPageUrl}`);
        } else if (html.includes('currentStreamLinks')) {
            streamPageUrl = `${BASE_URL}/search/title/${encodeURIComponent(filtered)}`;
        }

        if (!streamPageUrl) return [];

        const streamHtml = await fetch(streamPageUrl, { headers: DEFAULT_HEADERS }).then(r => r.text());
        const $stream = cheerio.load(streamHtml);
        const links = $stream('.currentStreamLinks a, .hosterSite span a, .streamList a').toArray();

        for (const el of links) {
            const href = $(el).attr('href');
            if (!href || href === '#' || href.includes('javascript:void')) continue;
            const fullUrl = href.startsWith('http') ? href : (href.startsWith('//') ? `https:${href}` : `https://${href}`);

            let directLink = null;

            if (fullUrl.includes('voe.sx')) {
                directLink = await extractVoe(fullUrl);
            } else if (/vidara\.(so|to)/.test(fullUrl)) {
                directLink = await extractVidara(fullUrl);
            }

            if (directLink) {
                results.push({
                    url: directLink,
                    meta: {
                        title: directLink, // Shows the complete .m3u8 URL
                        countryCodes: ['de']
                    }
                });
            }
        }
    } catch (e) { console.error("[Filmpalast] Scraper Error:", e.message); }

    return results.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);
}

module.exports = { getStreams };
