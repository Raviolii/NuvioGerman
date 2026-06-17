var cheerio = require('cheerio-without-node-native');

var BASE_URL = 'https://oha.to';
var API_KEY = 'ov262WdL5UdUUz4mwsOKLCFy3mLmLKXiN3Yz';
var LOKKE_PING_URL = 'https://www.lokke.app/api/app/ping';
var OHA_RESOLVE_URL = 'https://oha.to/web-vod/mediaurl-resolve.json';
var OHA_ITEM_URL = 'https://oha.to/mediaurl-item.json';
var OHA_SOURCE_URL = 'https://oha.to/mediaurl-source.json';

var DEFAULT_HEADERS = {
    'Authorization': 'Bearer ' + API_KEY,
    'Accept': 'application/json',
    'Origin': BASE_URL,
    'Referer': BASE_URL + '/'
};

// Standardizes miscellaneous Doodstream variations to the exact https://dood.yt/w/ID format
function normalizeDoodUrl(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.indexOf('dood') === -1) return url;
    
    var match = url.match(/\/[dew]\/([a-zA-Z0-9]+)/);
    if (match && match[1]) {
        return 'https://dood.yt/w/' + match[1];
    }
    return url;
}

function getLokkeHandshakePayload() {
    return {
        token: 'VKm7XwPbumwb9aeGoVi1fHa6ut1v41a5s6t-yzVQ4qZfN-VwHrdLcD18xPpL4qdzY92xAJiWD_7UZshSngIn_GTbU1uPRTuGFqYQCOBkXzu9YOUPV-u-EbB1WaSZjd6srGhQ',
        reason: 'app-blur',
        locale: 'de',
        theme: 'dark',
        metadata: {
            device: { 
                type: 'Handset', 
                brand: 'Apple', 
                model: 'iPhone 15 Pro', 
                name: 'iPhone', 
                uniqueId: 'E9B56A1F-810A-4C23-9D22-C8542FBB0D1C' 
            },
            os: { name: 'ios', version: '18.7.7', abis: ['ARM64E'], host: 'unknown' },
            app: { platform: 'ios', version: '1.0.2', buildId: '1.0.2', engine: 'jsc', installer: 'TestFlight' },
            version: { package: 'app.lokke.main', binary: '1.0.2', js: '1.0.4' },
        },
        appFocusTime: 0,
        playerActive: false,
        playDuration: 0,
        devMode: true,
        hasAddon: true,
        castConnected: false,
        package: 'app.lokke.main',
        version: '1.0.4',
        process: 'app',
        firstAppStart: Date.now(),
        lastAppStart: Date.now(),
        ipLocation: null,
        adblockEnabled: true,
        proxy: { supported: ['openvpn'], engine: 'openvpn', enabled: false, autoServer: true, id: 'fi-hel' },
        iap: { supported: true, error: 'No in-app payment subscriptions found' }
    };
}

// Sends the transformed target URL to the Oha Server backend via the authenticated handshake loop
function resolveDirectMediaUrl(targetHostUrl, itemLanguage) {
    var finalTargetUrl = normalizeDoodUrl(targetHostUrl);

    return fetch(LOKKE_PING_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Lokke/1.0.2 (iPhone; CPU iPhone OS 18_7_7 like Mac OS X)'
        },
        body: JSON.stringify(getLokkeHandshakePayload())
    })
    .then(function(res) { return res.json(); })
    .then(function(lokkeData) {
        var signature = lokkeData && lokkeData.addonSig;
        if (!signature) throw new Error('OhaTo: Signature validation failed');

        var ohaInputPayload = {
            language: itemLanguage || 'de',
            region: 'CH',
            url: finalTargetUrl,
            clientVersion: '3.0.2'
        };

        return fetch(OHA_RESOLVE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': '*/*',
                'User-Agent': 'MediaUrl/2',
                'Accept-Language': 'de-DE,de;q=0.9',
                'mediaurl-signature': signature
            },
            body: JSON.stringify(ohaInputPayload)
        });
    })
    .then(function(res) { return res.json(); })
    .then(function(ohaResult) {
        if (!ohaResult) return finalTargetUrl;
        
        var resolvedUrl = ohaResult.url || ohaResult.file || ohaResult.stream || 
                          (ohaResult.streams && ohaResult.streams[0] && ohaResult.streams[0].url) || 
                          (ohaResult.links && ohaResult.links[0]) || finalTargetUrl;
        return resolvedUrl;
    })
    .catch(function() {
        return finalTargetUrl;
    });
}

function getFinalRedirect(url) {
    return fetch(url, {
        method: 'GET',
        headers: DEFAULT_HEADERS,
        redirect: 'follow'
    })
    .then(function(res) { return res.url; })
    .catch(function() { return url; });
}

function handleLegacyLinksFlow(ohaId, fallbackTitle) {
    var linksUrl = BASE_URL + '/web-vod/api/links?id=' + ohaId;

    return fetch(linksUrl, { headers: DEFAULT_HEADERS })
        .then(function(res) { return res.json(); })
        .then(function(links) {
            if (!Array.isArray(links) || links.length === 0) return [];

            var promises = links.map(function(link) {
                if (!link.url) return Promise.resolve(null);

                var streamApiUrl = BASE_URL + '/web-vod/api/get?link=' + encodeURIComponent(link.url);

                return getFinalRedirect(streamApiUrl)
                    .then(function(finalUrl) {
                        var language = 'de';
                        if (link.languages && link.languages[0]) {
                            language = link.languages[0];
                        } else if (link.language) {
                            language = link.language;
                        }

                        var qualityTag = link.tag || 'HD';

                        if (finalUrl.indexOf('dood') !== -1 || finalUrl.indexOf('/w/') !== -1) {
                            return resolveDirectMediaUrl(finalUrl, language).then(function(directUrl) {
                                return {
                                    name: language.toUpperCase() + ' - ' + qualityTag,
                                    title: fallbackTitle,
                                    url: directUrl,
                                    quality: qualityTag,
                                    size: 'Unknown',
                                    headers: {
                                        'User-Agent': 'MediaUrl/2',
                                        'Referer': 'https://dood.li/'
                                    },
                                    provider: 'ohato'
                                };
                            });
                        }

                        return {
                            name: language.toUpperCase() + ' - ' + qualityTag,
                            title: fallbackTitle,
                            url: finalUrl,
                            quality: qualityTag,
                            size: 'Unknown',
                            headers: {
                                'User-Agent': 'MediaUrl/2',
                                'Referer': BASE_URL + '/'
                            },
                            provider: 'ohato'
                        };
                    })
                    .catch(function() { return null; });
            });

            return Promise.all(promises);
        })
        .then(function(results) {
            return results.filter(function(item) { return item !== null; });
        })
        .catch(function() { return []; });
}

function handleLokkeFlow(movieData) {
    return fetch(LOKKE_PING_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Lokke/1.0.2 (iPhone; CPU iPhone OS 18_7_7 like Mac OS X)'
        },
        body: JSON.stringify(getLokkeHandshakePayload())
    })
    .then(function(res) { return res.json(); })
    .then(function(lokkeResp) {
        var signature = lokkeResp && lokkeResp.addonSig;
        if (!signature) throw new Error('Missing Lokke Signature');

        var ohaHeaders = {
            'Content-Type': 'application/json',
            'mediaurl-signature': signature,
            'User-Agent': 'MediaUrl/2',
            'Accept-Language': 'de-DE,de;q=0.9',
            'Accept': '*/*'
        };

        var itemPayload = {
            language: movieData.language,
            region: movieData.region,
            type: movieData.type,
            ids: movieData.ids,
            name: movieData.name,
            episode: movieData.episode,
            clientVersion: movieData.clientVersion
        };

        return fetch(OHA_ITEM_URL, {
            method: 'POST',
            headers: ohaHeaders,
            body: JSON.stringify(itemPayload)
        })
        .then(function() {
            return fetch(OHA_SOURCE_URL, {
                method: 'POST',
                headers: ohaHeaders,
                body: JSON.stringify(movieData)
            });
        })
        .then(function(res) { return res.json(); })
        .then(function(finalData) {
            var candidates = Array.isArray(finalData) 
                ? finalData 
                : (finalData.streams || finalData.sources || finalData.items || []);

            var streamPromises = candidates.map(function(s) {
                var urlStr = s && (s.url || s.file || s.source || s.stream);
                if (!urlStr) return Promise.resolve(null);

                var language = 'de';
                if (s.languages && s.languages[0]) {
                    language = s.languages[0];
                } else if (s.language || s.lang) {
                    language = s.language || s.lang;
                } else if (movieData.language) {
                    language = movieData.language;
                }

                var qualityTag = s.tag || s.quality || 'HD';
                
                var mediaTitle = movieData.name;
                if (movieData.episode && movieData.episode.season) {
                    mediaTitle += ' S' + movieData.episode.season + 'E' + movieData.episode.episode;
                }
                if (movieData.releaseDate) {
                    var yearMatch = movieData.releaseDate.match(/^\d{4}/);
                    if (yearMatch) mediaTitle += ' (' + yearMatch[0] + ')';
                }

                if (urlStr.indexOf('dood') !== -1 || urlStr.indexOf('/w/') !== -1) {
                    return resolveDirectMediaUrl(urlStr, language).then(function(directUrl) {
                        return {
                            name: language.toUpperCase() + ' - ' + qualityTag,
                            title: mediaTitle,
                            url: directUrl,
                            quality: qualityTag,
                            size: s.size || 'Unknown',
                            headers: {
                                'User-Agent': 'MediaUrl/2',
                                'Referer': 'https://dood.li/'
                            },
                            provider: 'ohato'
                        };
                    });
                }

                return Promise.resolve({
                    name: language.toUpperCase() + ' - ' + qualityTag,
                    title: mediaTitle,
                    url: urlStr,
                    quality: qualityTag,
                    size: s.size || 'Unknown',
                    headers: {
                        'User-Agent': 'MediaUrl/2',
                        'Referer': BASE_URL + '/'
                    },
                    provider: 'ohato'
                });
            });

            return Promise.all(streamPromises);
        })
        .then(function(resolvedStreams) {
            return resolvedStreams.filter(function(item) { return item !== null; });
        });
    })
    .catch(function() { return []; });
}

function getStreams(tmdbId, type, season, episode) {
    var isSeries = (type === 'series' || type === 'show' || type === 'tv');
    var ohaId = isSeries ? 'series.' + tmdbId + '.' + season + '.' + (episode || 1) : 'movie.' + tmdbId;
    var infoUrl = BASE_URL + '/web-vod/api/info?id=' + ohaId;

    return fetch(infoUrl, { headers: DEFAULT_HEADERS })
        .then(function(res) {
            if (!res.ok) return null;
            return res.json();
        })
        .then(function(vodData) {
            var fallbackTitle = (vodData && (vodData.name || vodData.title)) || 'Media Title';
            
            if (!vodData) {
                return handleLegacyLinksFlow(ohaId, fallbackTitle);
            }

            var dynamicMovieData = {
                language: 'de',
                region: 'CH',
                type: isSeries ? 'series' : 'movie',
                ids: {
                    tmdb_id: String(vodData.tmdb_id || vodData.tmdbId || tmdbId),
                    imdb_id: String(vodData.imdb_id || vodData.imdbId || '')
                },
                name: fallbackTitle,
                originalName: vodData.original_name || vodData.originalTitle || vodData.name || vodData.title,
                releaseDate: vodData.release_date || vodData.releaseDate,
                nameTranslations: vodData.nameTranslations || { de: vodData.name || vodData.title },
                episode: isSeries ? {
                    ids: {
                        tmdb_episode_id:
                            (vodData.episode && (vodData.episode.tmdb_episode_id || vodData.episode.tmdbEpisodeId)) ||
                            vodData.tmdb_episode_id || vodData.tmdbEpisodeId || undefined
                    },
                    name: (vodData.episode && (vodData.episode.name || vodData.episode.title)) || undefined,
                    releaseDate: (vodData.episode && (vodData.episode.release_date || vodData.episode.releaseDate)) || undefined,
                    season: season,
                    episode: episode || 1
                } : {},
                clientVersion: '3.0.2'
            };

            return handleLokkeFlow(dynamicMovieData);
        })
        .catch(function(err) {
            console.log('[OHA.TO] Error: ' + err.message);
            return [];
        });
}

module.exports = { getStreams };
