// twitch-videoad.js text/javascript
(function() {
    if ( /(^|\.)twitch\.tv$/.test(document.location.hostname) === false ) { return; }
    var ourTwitchAdSolutionsVersion = 10.0; // Wersja hybrydowa
    if (typeof unsafeWindow === 'undefined') {
        unsafeWindow = window;
    }
    if (typeof unsafeWindow.twitchAdSolutionsVersion !== 'undefined' && unsafeWindow.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        console.log("skipping video-swap-new as there's another script active. ourVersion:" + ourTwitchAdSolutionsVersion + " activeVersion:" + unsafeWindow.twitchAdSolutionsVersion);
        unsafeWindow.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
        return;
    }
    unsafeWindow.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    function declareOptions(scope) {
        // Options / globals
        scope.OPT_MODE_STRIP_AD_SEGMENTS = true;
        scope.OPT_MODE_NOTIFY_ADS_WATCHED = true;
        scope.OPT_MODE_NOTIFY_ADS_WATCHED_MIN_REQUESTS = false;
        scope.OPT_BACKUP_PLAYER_TYPE = 'autoplay'; // Dla metody zapasowej
        scope.OPT_BACKUP_PLATFORM = 'ios';
        scope.OPT_REGULAR_PLAYER_TYPE = 'site'; // Dla metody proxy
        scope.OPT_ACCESS_TOKEN_PLAYER_TYPE = null;
        scope.OPT_SHOW_AD_BANNER = true;
        scope.AD_SIGNIFIER = 'stitched-ad';
        scope.LIVE_SIGNIFIER = ',live';
        scope.CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        scope.StreamInfos = [];
        scope.StreamInfosByUrl = [];
        scope.CurrentChannelNameFromM3U8 = null;
        scope.gql_device_id = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = null;
    }
    var twitchWorkers = [];
    var workerStringConflicts = ['twitch', 'isVariantA'];
    var workerStringAllow = [];
    var workerStringReinsert = ['isVariantA', 'besuper/', '${patch_url}'];

    function getCleanWorker(worker) {
        var root = null, parent = null, proto = worker;
        while (proto) {
            var workerString = proto.toString();
            if (workerStringConflicts.some(x => workerString.includes(x)) && !workerStringAllow.some(x => workerString.includes(x))) {
                if (parent !== null) Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
            } else {
                if (root === null) root = proto;
                parent = proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return root;
    }
    function getWorkersForReinsert(worker) {
        var result = [], proto = worker;
        while (proto) {
            var workerString = proto.toString();
            if (workerStringReinsert.some(x => workerString.includes(x))) result.push(proto);
            proto = Object.getPrototypeOf(proto);
        }
        return result;
    }
    function reinsertWorkers(worker, reinsert) {
        var parent = worker;
        for (var i = 0; i < reinsert.length; i++) {
            Object.setPrototypeOf(reinsert[i], parent);
            parent = reinsert[i];
        }
        return parent;
    }
    function isValidWorker(worker) {
        var workerString = worker.toString();
        return !workerStringConflicts.some(x => workerString.includes(x)) || workerStringAllow.some(x => workerString.includes(x)) || workerStringReinsert.some(x => workerString.includes(x));
    }
    function hookWindowWorker() {
        var reinsert = getWorkersForReinsert(unsafeWindow.Worker);
        var newWorker = class Worker extends getCleanWorker(unsafeWindow.Worker) {
            constructor(twitchBlobUrl, options) {
                var isTwitchWorker = false;
                try { isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv'); } catch {}
                if (!isTwitchWorker) {
                    super(twitchBlobUrl, options);
                    return;
                }
                var newBlobStr = `
                    const pendingFetchRequests = new Map();
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${makeGraphQlPacket.toString()}
                    ${tryNotifyAdsWatchedM3U8.toString()}
                    ${parseAttributes.toString()}
                    ${onFoundAd.toString()}
                    ${getWasmWorkerJs.toString()}
                    var workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UboUpdateDeviceId') gql_device_id = e.data.value;
                        else if (e.data.key == 'UpdateClientIntegrityHeader') ClientIntegrityHeader = e.data.value;
                        else if (e.data.key == 'UpdateAuthorizationHeader') AuthorizationHeader = e.data.value;
                        else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) reject(new Error(responseData.error));
                                else {
                                    const response = new Response(responseData.body, { status: responseData.status, statusText: responseData.statusText, headers: responseData.headers });
                                    resolve(response);
                                }
                            }
                        }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `;
                super(URL.createObjectURL(new Blob([newBlobStr])), options);
                twitchWorkers.push(this);
                this.addEventListener('message', e => {
                    if (e.data.key == 'UboShowAdBanner') {
                        var adDiv = getAdDiv();
                        if (adDiv != null) {
                            adDiv.P.textContent = 'Blocking' + (e.data.isMidroll ? ' midroll' : '') + ' ads' + (e.data.fallback ? ' (Fallback Mode)' : '');
                            if (OPT_SHOW_AD_BANNER) adDiv.style.display = 'block';
                        }
                    } else if (e.data.key == 'UboHideAdBanner') {
                        var adDiv = getAdDiv();
                        if (adDiv != null) adDiv.style.display = 'none';
                    } else if (e.data.key == 'UboReloadPlayer') reloadTwitchPlayer();
                    else if (e.data.key == 'UboPauseResumePlayer') reloadTwitchPlayer(false, true);
                    else if (e.data.key == 'UboSeekPlayer') reloadTwitchPlayer(true);
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({ key: 'FetchResponse', value: responseData });
                    }
                });
                function getAdDiv() {
                    var playerRootDiv = document.querySelector('.video-player');
                    var adDiv = null;
                    if (playerRootDiv != null) {
                        adDiv = playerRootDiv.querySelector('.ubo-overlay');
                        if (adDiv == null) {
                            adDiv = document.createElement('div');
                            adDiv.className = 'ubo-overlay';
                            adDiv.innerHTML = '<div class="player-ad-notice" style="color: white; background-color: rgba(0, 0, 0, 0.8); position: absolute; top: 0px; left: 0px; padding: 5px;"><p></p></div>';
                            adDiv.style.display = 'none';
                            adDiv.P = adDiv.querySelector('p');
                            playerRootDiv.appendChild(adDiv);
                        }
                    }
                    return adDiv;
                }
            }
        };
        var workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(unsafeWindow, 'Worker', {
            get: function() { return workerInstance; },
            set: function(value) {
                if (isValidWorker(value)) workerInstance = value;
                else console.log('Attempt to set twitch worker denied');
            }
        });
    }
    function getWasmWorkerJs(twitchBlobUrl) {
        var req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        return req.responseText;
    }
    function onFoundAd(streamInfo, textStr, reloadPlayer, isFallback) {
        console.log('Found ads, switch to backup' + (isFallback ? ' (Fallback)' : ''));
        streamInfo.UseBackupStream = true;
        streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
        if (reloadPlayer) postMessage({ key: 'UboReloadPlayer' });
        postMessage({ key: 'UboShowAdBanner', isMidroll: streamInfo.IsMidroll, fallback: isFallback });
    }
    async function processM3U8(url, textStr, realFetch) {
        var streamInfo = StreamInfosByUrl[url];
        if (streamInfo == null) { return textStr; }
        if (!OPT_MODE_STRIP_AD_SEGMENTS) { return textStr; }
        var haveAdTags = textStr.includes(AD_SIGNIFIER);
        if (streamInfo.UseBackupStream) {
            if (streamInfo.Encodings == null) {
                streamInfo.UseBackupStream = false;
                postMessage({ key: 'UboReloadPlayer' });
                return '';
            } else {
                var streamM3u8Url = streamInfo.Encodings.match(/^https:.*\.m3u8$/m)[0];
                var streamM3u8Response = await realFetch(streamM3u8Url);
                if (streamM3u8Response.status == 200) {
                    var streamM3u8 = await streamM3u8Response.text();
                    if (streamM3u8 != null) {
                        if (!streamM3u8.includes(AD_SIGNIFIER)) {
                            streamInfo.UseBackupStream = false;
                            postMessage({ key: 'UboHideAdBanner' });
                            postMessage({ key: 'UboReloadPlayer' });
                        }
                    }
                }
            }
        } else if (haveAdTags) {
            onFoundAd(streamInfo, textStr, true, true);
        } else {
            postMessage({ key: 'UboHideAdBanner' });
        }
        if (haveAdTags && streamInfo.BackupEncodings != null) {
            var streamM3u8Url = streamInfo.BackupEncodings.match(/^https:.*\.m3u8.*$/m)[0];
            var streamM3u8Response = await realFetch(streamM3u8Url);
            if (streamM3u8Response.status == 200) {
                textStr = await streamM3u8Response.text();
            }
        }
        return textStr;
    }

    function hookWorkerFetch() {
        console.log('hookWorkerFetch (Hybrid)');
        var realFetch = fetch;
        var proxyFailed = false;

        fetch = async function(url, options) {
            if (typeof url === 'string') {
                url = url.trimEnd();

                if (url.endsWith('m3u8')) {
                    return new Promise(function(resolve) {
                        realFetch(url, options).then(async function(response) {
                            var str = await processM3U8(url, await response.text(), realFetch);
                            resolve(new Response(str, { status: response.status, statusText: response.statusText, headers: response.headers }));
                        }).catch(function(err){
                            resolve(new Response('', {status: 500, statusText: 'Proxy Fallback M3U8 Fetch Failed'}));
                        });
                    });
                }
                else if (url.includes('/api/channel/hls/') && !url.includes('picture-by-picture')) {
                    var channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                    if (CurrentChannelNameFromM3U8 != channelName) {
                        postMessage({ key: 'UboChannelNameM3U8Changed', value: channelName });
                    }
                    CurrentChannelNameFromM3U8 = channelName;

                    if (!proxyFailed) {
                        try {
                            const accessTokenResponse = await getAccessToken(channelName, OPT_REGULAR_PLAYER_TYPE, 'web');
                            if (accessTokenResponse && accessTokenResponse.status === 200) {
                                const accessToken = await accessTokenResponse.json();
                                const token = accessToken.data.streamPlaybackAccessToken;

                                const proxyUrl = new URL(`https://api.ttv.lol/playlist/${channelName}.m3u8`);
                                proxyUrl.searchParams.set('sig', token.signature);
                                proxyUrl.searchParams.set('token', token.value);
                                proxyUrl.searchParams.set('allow_source', 'true');
                                
                                const proxyResponse = await realFetch(proxyUrl.toString());

                                if (proxyResponse.status === 200) {
                                    console.log(`[Hybrid AdBlock] Sukces! Użyto metody PROXY dla "${channelName}" (bez zmiany jakości).`);
                                    postMessage({ key: 'UboShowAdBanner', isMidroll: false, fallback: false });
                                    const playlist = await proxyResponse.text();
                                    var lines = playlist.replace('\r', '').split('\n');
                                    for (var j = 0; j < lines.length; j++) {
                                        if (!lines[j].startsWith('#') && lines[j].includes('.m3u8')) {
                                            StreamInfosByUrl[lines[j].trimEnd()] = StreamInfos[channelName] || {};
                                        }
                                    }
                                    setTimeout(() => postMessage({ key: 'UboHideAdBanner' }), 2000);
                                    return new Response(playlist);
                                } else {
                                    throw new Error(`Proxy zwróciło status ${proxyResponse.status}`);
                                }
                            } else {
                                throw new Error('Nie udało się pobrać tokenu dostępu dla proxy.');
                            }
                        } catch (error) {
                            console.warn(`[Hybrid AdBlock] Metoda PROXY zawiodła: ${error.message}. Przełączam na metodę ZAPASOWĄ.`);
                            proxyFailed = true;
                        }
                    }

                    return new Promise(async function(resolve, reject) {
                        console.log(`[Hybrid AdBlock] Używam metody ZAPASOWEJ dla "${channelName}" (z możliwą zmianą jakości).`);
                        var streamInfo = StreamInfos[channelName];
                        if (streamInfo != null && streamInfo.Encodings != null) {
                             const mainStreamUrl = streamInfo.Encodings.match(/^https:.*\.m3u8$/m)[0];
                             if (mainStreamUrl && (await realFetch(mainStreamUrl)).status !== 200) {
                                 streamInfo = null;
                             }
                        }

                        if (streamInfo == null || streamInfo.Encodings == null || streamInfo.BackupEncodings == null) {
                            StreamInfos[channelName] = streamInfo = {
                                RequestedAds: new Set(), Encodings: null, BackupEncodings: null,
                                IsMidroll: false, UseBackupStream: false, ChannelName: channelName
                            };
                            for (var i = 0; i < 2; i++) {
                                var encodingsUrl = url;
                                if (i == 1) {
                                    var accessTokenResponse = await getAccessToken(channelName, OPT_BACKUP_PLAYER_TYPE, OPT_BACKUP_PLATFORM);
                                    if (accessTokenResponse != null && accessTokenResponse.status === 200) {
                                        var accessToken = await accessTokenResponse.json();
                                        var urlInfo = new URL('https://usher.ttvnw.net/api/channel/hls/' + channelName + '.m3u8' + (new URL(url)).search);
                                        urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                                        urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                                        encodingsUrl = urlInfo.href;
                                    } else { resolve(accessTokenResponse); return; }
                                }
                                var encodingsM3u8Response = await realFetch(encodingsUrl, options);
                                if (encodingsM3u8Response != null && encodingsM3u8Response.status === 200) {
                                    var encodingsM3u8 = await encodingsM3u8Response.text();
                                    if (i == 0) {
                                        streamInfo.Encodings = encodingsM3u8;
                                        var streamM3u8Url = encodingsM3u8.match(/^https:.*\.m3u8$/m)[0];
                                        var streamM3u8Response = await realFetch(streamM3u8Url);
                                        if (streamM3u8Response.status == 200) {
                                            var streamM3u8 = await streamM3u8Response.text();
                                            if (streamM3u8.includes(AD_SIGNIFIER)) onFoundAd(streamInfo, streamM3u8, false, true);
                                        } else { resolve(streamM3u8Response); return; }
                                    } else {
                                        streamInfo.BackupEncodings = encodingsM3u8;
                                    }
                                    var lines = encodingsM3u8.replace('\r', '').split('\n');
                                    for (var j = 0; j < lines.length; j++) {
                                        if (!lines[j].startsWith('#') && lines[j].includes('.m3u8')) {
                                            StreamInfosByUrl[lines[j].trimEnd()] = streamInfo;
                                        }
                                    }
                                } else { resolve(encodingsM3u8Response); return; }
                            }
                        }
                        if (streamInfo.UseBackupStream) resolve(new Response(streamInfo.BackupEncodings));
                        else resolve(new Response(streamInfo.Encodings));
                    });
                }
            }
            return realFetch.apply(this, arguments);
        }
    }

    function makeGraphQlPacket(event, radToken, payload) { return [{operationName:'ClientSideAdEventHandling_RecordAdEvent',variables:{input:{eventName:event,eventPayload:JSON.stringify(payload),radToken,},},extensions:{persistedQuery:{version:1,sha256Hash:'7e6c69e6eb59f8ccb97ab73686f3d8b7d85a72a0298745ccd8bfc68e4054ca5b',},},}]; }
    function getAccessToken(channelName, playerType, platform) { if (!platform) platform = 'web'; var body = {operationName:'PlaybackAccessToken_Template',query:'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "' + platform + '", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature    __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "' + platform + '", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}',variables:{'isLive':true,'login':channelName,'isVod':false,'vodID':'','playerType':playerType}}; return gqlRequest(body); }
    function gqlRequest(body) { if (!gql_device_id) { const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'; gql_device_id = ''; for (let i = 0; i < 32; i += 1) gql_device_id += chars.charAt(Math.floor(Math.random() * chars.length)); } var headers = {'Client-Id':CLIENT_ID,'Client-Integrity':ClientIntegrityHeader,'X-Device-Id':gql_device_id,'Authorization':AuthorizationHeader}; return new Promise((resolve, reject) => { const requestId = Math.random().toString(36).substring(2, 15); const fetchRequest = {id:requestId,url:'https://gql.twitch.tv/gql',options:{method:'POST',body:JSON.stringify(body),headers}}; pendingFetchRequests.set(requestId, {resolve,reject}); postMessage({key:'FetchRequest',value:fetchRequest}); }); }
    function parseAttributes(str) { return Object.fromEntries(str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/).filter(Boolean).map(x => { const idx = x.indexOf('='); const key = x.substring(0, idx); const value = x.substring(idx + 1); const num = Number(value); return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num] })); }
    async function tryNotifyAdsWatchedM3U8(streamM3u8) { try { if (!streamM3u8 || !streamM3u8.includes(AD_SIGNIFIER)) { return 1; } var matches = streamM3u8.match(/#EXT-X-DATERANGE:(ID="stitched-ad-[^\n]+)\n/); if (matches.length > 1) { const attrString = matches[1]; const attr = parseAttributes(attrString); var podLength = parseInt(attr['X-TV-TWITCH-AD-POD-LENGTH'] ? attr['X-TV-TWITCH-AD-POD-LENGTH'] : '1'); var radToken = attr['X-TV-TWITCH-AD-RADS-TOKEN']; var lineItemId = attr['X-TV-TWITCH-AD-LINE-ITEM-ID']; var orderId = attr['X-TV-TWITCH-AD-ORDER-ID']; var creativeId = attr['X-TV-TWITCH-AD-CREATIVE-ID']; var adId = attr['X-TV-TWITCH-AD-ADVERTISER-ID']; var rollType = attr['X-TV-TWITCH-AD-ROLL-TYPE'].toLowerCase(); const baseData = { stitched: true, roll_type: rollType, player_mute: false, player_volume: 0.5, visible: true, }; for (let podPosition = 0; podPosition < podLength; podPosition++) { if (OPT_MODE_NOTIFY_ADS_WATCHED_MIN_REQUESTS) { await gqlRequest(makeGraphQlPacket('video_ad_pod_complete', radToken, baseData)); } else { const extendedData = { ...baseData, ad_id: adId, ad_position: podPosition, duration: 30, creative_id: creativeId, total_ads: podLength, order_id: orderId, line_item_id: lineItemId, }; await gqlRequest(makeGraphQlPacket('video_ad_impression', radToken, extendedData)); for (let quartile = 0; quartile < 4; quartile++) { await gqlRequest(makeGraphQlPacket('video_ad_quartile_complete', radToken, { ...extendedData, quartile: quartile + 1, })); } await gqlRequest(makeGraphQlPacket('video_ad_pod_complete', radToken, baseData)); } } } return 0; } catch (err) { console.log(err); return 0; } }
    function postTwitchWorkerMessage(key, value) { twitchWorkers.forEach((worker) => { worker.postMessage({ key: key, value: value }); }); }
    async function handleWorkerFetchRequest(fetchRequest) { try { if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest !== 'undefined') { fetchRequest.options.headers['Sec-Ch-Ua'] = '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"'; fetchRequest.options.headers['Referer'] = 'https://www.twitch.tv/'; const response = await new Promise((resolve, reject) => { GM.xmlHttpRequest({ method: fetchRequest.options.method, url: fetchRequest.url, data: fetchRequest.options.body, headers: fetchRequest.options.headers, onload: response => resolve(response), onerror: error => reject(error) }); }); const headers = new Headers(); const lines = response.responseHeaders.trim().split(/[\r\n]+/); lines.forEach(line => { const parts = line.split(': '); const header = parts.shift(); const value = parts.join(': '); headers.append(header, value); }); return { id: fetchRequest.id, status: response.status, statusText: response.statusText, headers: Object.fromEntries(headers.entries()), body: response.responseText }; } const response = await unsafeWindow.realFetch(fetchRequest.url, fetchRequest.options); const responseBody = await response.text(); return { id: fetchRequest.id, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), body: responseBody }; } catch (error) { return { id: fetchRequest.id, error: error.message }; } }
    function hookFetch() {
        var realFetch = unsafeWindow.fetch;
        unsafeWindow.realFetch = realFetch;
        unsafeWindow.fetch = function(url, init, ...args) {
            if (typeof url === 'string' && url.includes('gql')) {
                var deviceId = init.headers['X-Device-Id'] || init.headers['Device-ID'];
                if (typeof deviceId === 'string') gql_device_id = deviceId;
                if (gql_device_id) postTwitchWorkerMessage('UboUpdateDeviceId', gql_device_id);
                if (typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                    if (typeof init.headers['Client-Integrity'] === 'string') {
                        ClientIntegrityHeader = init.headers['Client-Integrity'];
                        if (ClientIntegrityHeader) postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader);
                    }
                    if (typeof init.headers['Authorization'] === 'string') {
                        AuthorizationHeader = init.headers['Authorization'];
                        if (AuthorizationHeader) postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader);
                    }
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function reloadTwitchPlayer(isSeek, isPausePlay) {
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) return root.stateNode;
            let node = root.child;
            while (node) {
                const result = findReactNode(node, constraint);
                if (result) return result;
                node = node.sibling;
            }
            return null;
        }
        var reactRootNode = null;
        var rootNode = document.querySelector('#root');
        if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
            reactRootNode = rootNode._reactRootContainer._internalRoot.current;
        } else if(rootNode) {
            var containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
            if (containerName != null) reactRootNode = rootNode[containerName];
        }
        if (!reactRootNode) return;
        var player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
        player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
        var playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
        if (!player || !playerState) return;
        if (player.paused || player.core?.paused) return;
        if (isSeek) {
            var pos = player.getPosition();
            player.seekTo(0);
            player.seekTo(pos);
            return;
        }
        if (isPausePlay) {
            player.pause();
            player.play();
            return;
        }
        playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
    }
    function onContentLoaded() {
        try { Object.defineProperty(document, 'visibilityState', { get() { return 'visible'; } }); } catch {}
        try { Object.defineProperty(document, 'hidden', { get() { return false; } }); } catch {}
        var block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
        document.addEventListener('visibilitychange', block, true);
        document.addEventListener('webkitvisibilitychange', block, true);
        document.addEventListener('mozvisibilitychange', block, true);
        document.addEventListener('hasFocus', block, true);
    }

    unsafeWindow.reloadTwitchPlayer = reloadTwitchPlayer;
    declareOptions(unsafeWindow);
    hookWindowWorker();
    hookFetch();
    if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
        onContentLoaded();
    } else {
        unsafeWindow.addEventListener("DOMContentLoaded", function() { onContentLoaded(); });
    }
})();
