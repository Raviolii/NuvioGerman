var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://s.to';
var TMDB_API_KEY = 'b1b501578f88cfaaaf0178b3d392ccf9';
var TMDB_BASE_URL = 'https://api.themoviedb.org/3';
var LOKKE_PING_URL = 'https://www.lokke.app/api/app/ping';
var OHA_RESOLVE_URL = 'https://oha.to/web-vod/mediaurl-resolve.json';

var DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

function extractDomain(url) {
    if (!url || typeof url !== 'string') return 'Server';
    var matches = url.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    return matches ? matches[1].replace(/^www\./i, '') : 'Server';
}

function normalizeVoeUrl(url) {
    if (!url || typeof url !== 'string') return url;
    var match = url.match(/(?:\/voe)?\/([a-zA-Z0-9]+)(?:\?|$)/);
    return match ? 'https://voe.sx/' + match[1] : url;
}

async function getFinalRedirect(url, referer) {
    try {
        let currentUrl = url;
        for (let i = 0; i < 3; i++) {
            const response = await fetch(currentUrl, {
                method: 'GET',
                headers: { ...DEFAULT_HEADERS, 'Referer': referer },
                redirect: 'manual'
            });
            const location = response.headers.get('location');
            if (location) {
                currentUrl = location.startsWith('/') ? BASE_URL + location : location;
            } else {
                const text = await response.text();
                const metaMatch = text.match(/url=([^"']+)/i);
                if (metaMatch) currentUrl = metaMatch[1];
                else return currentUrl;
            }
        }
        return currentUrl;
    } catch (e) { return url; }
}

async function handleOhaTaskLoop(ohaResult, ohaHeaders) {
    if (!ohaResult || ohaResult.kind !== 'taskRequest') return ohaResult;
    const { url, params } = ohaResult.data;
    const res = await fetch(url, { method: params.method || 'GET', headers: params.headers || {} });
    const text = await res.text();
    const headers = {};
    res.headers.forEach((v, k) => headers[k] = v);
    
    const nextRes = await fetch(OHA_RESOLVE_URL, {
        method: 'POST',
        headers: ohaHeaders,
        body: JSON.stringify({ kind: "taskResponse", id: ohaResult.id, data: { status: res.status, url: res.url, headers, text } })
    });
    return handleOhaTaskLoop(await nextRes.json(), ohaHeaders);
}

async function resolveDirectMediaUrl(targetHostUrl, itemLanguage) {
    const finalUrl = normalizeVoeUrl(targetHostUrl);
    const pingRes = await fetch(LOKKE_PING_URL, { method: 'POST', body: JSON.stringify({ package: 'app.lokke.main' }), headers: {'Content-Type': 'application/json'} });
    const lokkeData = await pingRes.json();
    const sig = lokkeData.addonSig;

    const ohaHeaders = { 'Content-Type': 'application/json', 'mediaurl-signature': sig, 'User-Agent': 'MediaUrl/2' };
    const initialOha = await fetch(OHA_RESOLVE_URL, {
        method: 'POST',
        headers: ohaHeaders,
        body: JSON.stringify({ language: itemLanguage, url: finalUrl })
    });
    
    const finalResult = await handleOhaTaskLoop(await initialOha.json(), ohaHeaders);
    return { url: finalResult.url || finalResult.file || finalUrl, signature: sig };
}

async function getStreams(tmdbId, type, season, episode) {
    if (type !== 'series' && type !== 'show' && type !== 'tv') return [];
    var results = [];

    try {
        const idRes = await fetch(`${TMDB_BASE_URL}/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
        const imdbId = (await idRes.json()).imdb_id;
        if (!imdbId) return [];

        const searchRes = await fetch(`${BASE_URL}/suche?term=${imdbId}`, { headers: DEFAULT_HEADERS });
        const $search = cheerio.load(await searchRes.text());
        const seriesLink = $search('.col-6.col-md-4.col-lg-2 a.show-cover').attr('href') || new URL(searchRes.url).pathname;

        const epRes = await fetch(`${BASE_URL}${seriesLink}/staffel-${season}/episode-${episode}`, { headers: DEFAULT_HEADERS });
        const $ep = cheerio.load(await epRes.text());
        const linkBoxes = $ep('button.link-box[data-language-id="1"]').toArray();
        
        for (let el of linkBoxes) {
            const playPath = $ep(el).attr('data-play-url');
            const hosterName = $ep(el).attr('data-provider-name') || 'Hoster';
            if (!playPath || !hosterName.toLowerCase().includes('voe')) continue;

            const targetUrl = await getFinalRedirect(BASE_URL + playPath, BASE_URL + seriesLink);
            const resolution = await resolveDirectMediaUrl(targetUrl, 'de');

            results.push({
                name: 'DE - ' + hosterName.toUpperCase(),
                url: resolution.url,
                quality: 'HD',
                headers: { 'User-Agent': 'MediaUrl/2', 'mediaurl-signature': resolution.signature }
            });
        }
    } catch (e) {}
    return results;
}

module.exports = { getStreams };
