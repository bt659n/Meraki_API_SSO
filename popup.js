window.apiRegistry = {}; 
let globalSpec = null; 
let currentSelectedApi = null; 
let apiTreeRoot = {}; 

let rawResponseData = null; // Store raw JSON response
let currentTableData = [];   // Store flat array of objects for table searching & CSV export
let tableHeaders = [];       // Store sorted header list

document.addEventListener('DOMContentLoaded', () => {
    const currentYear = new Date().getFullYear();
    const whatsNewLink = document.getElementById('link-whatsnew');
    if (whatsNewLink) {
        whatsNewLink.href = `https://developer.cisco.com/meraki/whats-new/${currentYear}/#whats-new`;
    }

    chrome.storage.local.get(['merakiSpec'], (data) => {
        if (data.merakiSpec) {
            globalSpec = data.merakiSpec;
            
            const badge = document.getElementById('spec-version-badge');
            if (badge && globalSpec.info) {
                const apiVer = globalSpec.info.version || 'Unknown';
                const oasVer = globalSpec.openapi || '?';
                badge.innerText = `v${apiVer} (OAS ${oasVer})`;
                badge.style.display = 'inline-block';
            }

            buildDeepApiTree(); 
            renderCollapsibleTree(); 
        } else {
            document.getElementById('api-desc').innerText = "API specification cache not found. Please verify background.js is running properly.";
        }
    });

    // Env change listener
    const envSelect = document.getElementById('env-select');

    // Update spec button listener
    document.getElementById('update-spec-btn').addEventListener('click', forceUpdateSpec);

    document.getElementById('run-btn').addEventListener('click', runApi);
    document.getElementById('api-search').addEventListener('input', handleApiSearch);
    
    // Tab switching
    const tabJson = document.getElementById('tab-json');
    const tabTable = document.getElementById('tab-table');
    const jsonPane = document.getElementById('json-view-pane');
    const tablePane = document.getElementById('table-view-pane');
    
    tabJson.addEventListener('click', () => {
        tabJson.classList.add('active');
        tabTable.classList.remove('active');
        jsonPane.classList.add('active');
        tablePane.classList.remove('active');
    });
    
    tabTable.addEventListener('click', () => {
        tabTable.classList.add('active');
        tabJson.classList.remove('active');
        tablePane.classList.add('active');
        jsonPane.classList.remove('active');
    });

    // Copy Data button listener
    document.getElementById('copy-btn').addEventListener('click', function() {
        const isJsonTab = tabJson.classList.contains('active');
        let textToCopy = '';
        
        if (isJsonTab) {
            if (!rawResponseData) return;
            textToCopy = typeof rawResponseData === 'object' ? JSON.stringify(rawResponseData, null, 2) : String(rawResponseData);
        } else {
            if (currentTableData.length === 0) return;
            const keyword = document.getElementById('table-search').value.trim().toLowerCase();
            const filteredData = currentTableData.filter(row => {
                if (!keyword) return true;
                return Object.values(row).some(val => {
                    if (val === null || val === undefined) return false;
                    return String(val).toLowerCase().includes(keyword);
                });
            });
            
            textToCopy = tableHeaders.join(',') + '\n' + filteredData.map(row => {
                return tableHeaders.map(h => {
                    const val = row[h];
                    if (val === undefined || val === null) return '';
                    if (typeof val === 'object') return JSON.stringify(val);
                    const valStr = String(val);
                    return valStr.includes(',') || valStr.includes('"') || valStr.includes('\n') 
                        ? `"${valStr.replace(/"/g, '""')}"` 
                        : valStr;
                }).join(',');
            }).join('\n');
        }
        
        if (!textToCopy) return;
        
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = this.innerText;
            this.innerText = '✅ Copied!';
            this.classList.add('copied');
            setTimeout(() => {
                this.innerText = '📋 Copy Data';
                this.classList.remove('copied');
            }, 2000);
        });
    });

    // CSV Export button listener
    document.getElementById('export-csv-btn').addEventListener('click', exportToCsv);

    // Table search input filter listener
    document.getElementById('table-search').addEventListener('input', handleTableSearch);
});

function formatTagName(str) {
    const acronyms = {
        'jwks': 'JWKS', 'vlans': 'VLANs', 'bgp': 'BGP', 'ospf': 'OSPF', 
        'vpn': 'VPN', 'ssid': 'SSID', 'ssids': 'SSIDs', 'api': 'API', 
        'pii': 'PII', 'qos': 'QoS', 'mtu': 'MTU', 'lldp': 'LLDP', 'cdp': 'CDP'
    };
    if (acronyms[str.toLowerCase()]) return acronyms[str.toLowerCase()];
    let formatted = str.replace(/([A-Z])/g, ' $1').trim();
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function buildDeepApiTree() {
    apiTreeRoot = {};
    window.apiRegistry = {}; 

    for (const path in globalSpec.paths) {
        const methods = ['get', 'post'];
        for (const method of methods) {
            const apiDef = globalSpec.paths[path][method];
            if (!apiDef || !apiDef.tags) continue;

            const tags = apiDef.tags;
            const action = tags[1] ? tags[1].toLowerCase() : '';

            if (method === 'post' && action !== 'livetools') continue; 

            const product = formatTagName(tags[0] || 'General');
            const subComponents = tags.slice(2).map(t => formatTagName(t));
            
            let currentLevel = apiTreeRoot;
            
            if (!currentLevel[product]) currentLevel[product] = { isCategory: true, children: {} };
            currentLevel = currentLevel[product].children;
            
            subComponents.forEach(comp => {
                if (!currentLevel[comp]) currentLevel[comp] = { isCategory: true, children: {} };
                currentLevel = currentLevel[comp].children;
            });

            const apiSummary = apiDef.summary || path;
            const uniqueApiId = btoa(method + '_' + path).replace(/=/g, ''); 
            
            window.apiRegistry[uniqueApiId] = {
                path: path,
                method: method.toUpperCase(),
                summary: apiSummary,
                details: apiDef
            };

            currentLevel[apiSummary] = {
                isCategory: false,
                apiId: uniqueApiId,
                method: method.toUpperCase()
            };
        }
    }
}

function renderCollapsibleTree() {
    const treeContainer = document.getElementById('category-tree-container');
    
    function generateHtml(node) {
        let html = '';
        Object.keys(node).sort().forEach(key => {
            const item = node[key];
            if (item.isCategory) {
                html += `
                    <details>
                        <summary>${key}</summary>
                        <div style="margin-left: 4px;">
                            ${generateHtml(item.children)}
                        </div>
                    </details>
                `;
            } else {
                const methodClass = item.method.toLowerCase();
                html += `
                    <div class="tree-leaf" data-api-id="${item.apiId}">
                        <span class="method-tag ${methodClass}">${item.method}</span>
                        <span>${key}</span>
                    </div>
                `;
            }
        });
        return html;
    }

    treeContainer.innerHTML = generateHtml(apiTreeRoot);
    bindTreeLeafClickEvents();
}

function bindTreeLeafClickEvents() {
    const treeContainer = document.getElementById('category-tree-container');
    treeContainer.querySelectorAll('.tree-leaf').forEach(leaf => {
        leaf.addEventListener('click', function() {
            treeContainer.querySelectorAll('.tree-leaf').forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            loadApiToConsole(this.dataset.apiId);
        });
    });
}

function handleApiSearch(e) {
    const keyword = e.target.value.trim().toLowerCase();
    const treeContainer = document.getElementById('category-tree-container');
    
    if (!keyword) {
        renderCollapsibleTree();
        return;
    }

    const tokens = keyword.split(/\s+/).filter(t => t.length > 0);

    let searchHtml = '';
    Object.keys(window.apiRegistry).forEach(apiId => {
        const apiObj = window.apiRegistry[apiId];
        const opId = (apiObj.details.operationId || '').toLowerCase();
        const path = (apiObj.path || '').toLowerCase();
        const summary = (apiObj.summary || '').toLowerCase();
        
        const matchString = (target) => {
            let currentIndex = 0;
            for (const token of tokens) {
                const index = target.indexOf(token, currentIndex);
                if (index === -1) return false;
                currentIndex = index + token.length;
            }
            return true;
        };

        const isMatch = matchString(opId) || matchString(path) || matchString(summary);
        
        if (isMatch) {
            const methodClass = apiObj.method.toLowerCase();
            searchHtml += `
                <div class="tree-leaf" data-api-id="${apiId}" style="margin-left: 0px; border-bottom: 1px solid #f1f5f9; padding: 8px 4px;">
                    <div>
                        <span class="method-tag ${methodClass}">${apiObj.method}</span>
                        <span style="font-weight: 600; color: #1e293b;">${apiObj.details.operationId || apiObj.summary}</span>
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px; padding-left: 42px;">${apiObj.path}</div>
                    </div>
                </div>
            `;
        }
    });

    if (searchHtml) {
        treeContainer.innerHTML = searchHtml;
    } else {
        treeContainer.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 15px; font-size: 12px;">❌ No matching Operation ID found</div>';
    }
    
    bindTreeLeafClickEvents();
}

function loadApiToConsole(apiId) {
    const apiObj = window.apiRegistry[apiId];
    if (!apiObj) return;

    currentSelectedApi = apiObj;
    const paramContainer = document.getElementById('param-container');
    paramContainer.innerHTML = ''; 

    document.getElementById('api-desc').innerHTML = `
        <strong>[${apiObj.method}]</strong> <code style="color:#0284c7;">${apiObj.path}</code><br>
        <strong>Operation ID:</strong> <code style="background:#e2e8f0; padding:2px 5px; border-radius:3px; color:#0f172a; font-family:monospace;">${apiObj.details.operationId || 'None'}</code><br><br>
        <strong>Description:</strong> ${apiObj.details.description || 'No detailed description available.'}
    `;

    const apiParams = apiObj.details.parameters || [];
    let pathHtml = '';
    let queryHtml = '';

    if (apiParams.length > 0) {
        apiParams.forEach(param => {
            const descHtml = param.description 
                ? `<div style="font-size: 11px; color: #64748b; margin-top: 4px; line-height: 1.35; padding-left: 2px; word-break: break-word;">${param.description}</div>` 
                : '';

            if (param.in === 'path') {
                pathHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label><span style="color:#dc2626;">*</span> ${param.name} <small style="color:#64748b; font-weight:normal;">(Required Path Param)</small>:</label>
                        <input type="text" id="param-path-${param.name}" placeholder="Enter ${param.name}" required>
                        ${descHtml}
                    </div>`;
            } else if (param.in === 'query') {
                let inputHtml = '';
                if (['t0', 't1'].includes(param.name)) {
                    inputHtml = `
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="param-query-${param.name}" placeholder="Supports ISO 8601 or Unix Epoch" data-param-name="${param.name}" style="flex: 1;">
                            <input type="datetime-local" id="param-query-date-${param.name}" title="Set selected local time as UTC" style="width: 170px; padding: 6px; box-sizing: border-box; border: 1px solid #16a34a; border-radius: 4px; font-size: 12px; cursor: pointer; color: #16a34a; background: #f0fdf4;">
                        </div>`;
                } else {
                    inputHtml = `<input type="text" id="param-query-${param.name}" placeholder="Enter ${param.name}" data-param-name="${param.name}">`;
                }

                queryHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label>${param.name} <small style="color:#0284c7; font-weight:normal;">(Optional Query Param)</small>:</label>
                        ${inputHtml}
                        ${descHtml}
                    </div>`;
            }
        });
    } else {
        const pathParamsMatch = apiObj.path.match(/\{([^}]+)\}/g);
        if (pathParamsMatch) {
            pathParamsMatch.forEach(param => {
                const paramName = param.replace(/[{}]/g, ''); 
                pathHtml += `
                    <div class="param-group" style="margin-bottom: 12px;">
                        <label><span style="color:#dc2626;">*</span> ${paramName} <small style="color:#64748b; font-weight:normal;">(Required Path Param)</small>:</label>
                        <input type="text" id="param-path-${paramName}" placeholder="Enter ${paramName}" required>
                    </div>`;
            });
        }
    }

    let finalHtml = pathHtml || '<label style="color:#16a34a; display:block; margin-bottom:4px;">✓ This API does not require any path parameters.</label>';
    
    if (queryHtml) {
        finalHtml += `
            <details class="query-collapse">
                <summary>⚙️ Advanced Optional Query Parameters</summary>
                <div style="margin-top: 6px; padding: 2px;">
                    ${queryHtml}
                </div>
            </details>
        `;
    }

    if (apiObj.method === 'POST') {
        finalHtml += `<div style="color:#ea580c; margin-top:8px; font-size:11px; font-weight:bold;">* This operation is a LiveTool diagnostic task and will be triggered with an empty request body.</div>`;
    }

    paramContainer.innerHTML = finalHtml;

    ['t0', 't1'].forEach(timeParam => {
        const datePicker = document.getElementById(`param-query-date-${timeParam}`);
        const textInput = document.getElementById(`param-query-${timeParam}`);
        if (datePicker && textInput) {
            const syncTime = () => {
                textInput.value = datePicker.value ? datePicker.value + ':00Z' : '';
            };
            datePicker.addEventListener('input', syncTime);
            datePicker.addEventListener('change', syncTime);
        }
    });
}

async function runApi() {
    if (!currentSelectedApi) return alert("Please select an API operation first.");
    
    const logBox = document.getElementById('debug-log');
    const treeContainer = document.getElementById('data-result-tree');
    const envDomain = document.getElementById('env-select').value; 
    
    treeContainer.innerText = "Executing request, please wait...";
    
    // Hide table tab initially and reset variables
    document.getElementById('tab-table').style.display = 'none';
    document.getElementById('table-search').value = '';
    document.getElementById('tab-json').click();
    
    rawResponseData = null;
    currentTableData = [];
    tableHeaders = [];
    
    let debugLogs = `=======================================\n🚀 [${currentSelectedApi.method}] ${currentSelectedApi.path}\n=======================================\n`;
    const log = (msg) => {
        debugLogs += `> ${msg}\n`;
        logBox.innerText = debugLogs;
        logBox.scrollTop = logBox.scrollHeight;
    };

    let finalPath = currentSelectedApi.path;
    const method = currentSelectedApi.method;
    const apiParams = currentSelectedApi.details.parameters || [];
    
    if (apiParams.length > 0) {
        for (const param of apiParams) {
            if (param.in === 'path') {
                const el = document.getElementById(`param-path-${param.name}`);
                const val = el ? el.value.trim() : '';
                if (!val) {
                    log(`❌ Terminated: Required parameter ${param.name} is missing!`);
                    treeContainer.innerText = "Aborted: Missing required path parameters.";
                    return;
                }
                finalPath = finalPath.replace(`{${param.name}}`, val);
            }
        }
    } else {
        const pathParamsMatch = finalPath.match(/\{([^}]+)\}/g);
        if (pathParamsMatch) {
            for (const param of pathParamsMatch) {
                const paramName = param.replace(/[{}]/g, '');
                const val = document.getElementById(`param-path-${paramName}`).value.trim();
                if (!val) {
                    log(`❌ Terminated: Required parameter ${paramName} is missing!`);
                    treeContainer.innerText = "Aborted: Missing required path parameters.";
                    return;
                }
                finalPath = finalPath.replace(param, val);
            }
        }
    }

    const queryPairs = [];
    if (apiParams.length > 0) {
        apiParams.forEach(param => {
            if (param.in === 'query') {
                const el = document.getElementById(`param-query-${param.name}`);
                let val = el ? el.value.trim() : '';

                if (!val && ['t0', 't1'].includes(param.name)) {
                    const dateEl = document.getElementById(`param-query-date-${param.name}`);
                    if (dateEl && dateEl.value) {
                        val = dateEl.value + ':00Z';
                        if (el) el.value = val; 
                    }
                }

                if (val) {
                    queryPairs.push(`${encodeURIComponent(param.name)}=${encodeURIComponent(val)}`);
                }
            }
        });
    }

    const baseQueryString = queryPairs.length > 0 ? `?${queryPairs.join('&')}` : '';
    let targetUrl = `https://${envDomain}/api/v1${finalPath}${baseQueryString}`;
    let baseUrlWithoutCursor = targetUrl; 
    
    try {
        const fetchOptions = {
            method: method,
            credentials: 'include', 
            headers: { "Accept": "application/json", "Content-Type": "application/json" }
        };

        if (method === 'POST') fetchOptions.body = JSON.stringify({});

        let aggregatedData = [];
        let isPaginatedFlow = false;
        let currentPageIndex = 0;
        let lastFirstItemId = null; 
        const MAX_PAGE_SAFETY_LIMIT = 50; 

        log(`Verifying session and starting request transmission to ${envDomain}...`);

        while (targetUrl) {
            currentPageIndex++;
            log(`[Page ${currentPageIndex}] Dispatching Fetch: ${targetUrl}`);

            const response = await fetch(targetUrl, fetchOptions);
            
            if (!response.ok) {
                const text = await response.text();
                let errData = text; try { errData = JSON.parse(text); } catch(e){}
                log(`❌ Request denied by API gateway (HTTP ${response.status})`);
                treeContainer.innerText = typeof errData === 'object' ? JSON.stringify(errData, null, 2) : errData;
                return;
            }

            const text = await response.text();
            let pageJson;
            try {
                pageJson = text ? JSON.parse(text) : null;
            } catch (e) {
                pageJson = text;
            }

            let itemCount = Array.isArray(pageJson) ? pageJson.length : (typeof pageJson === 'object' ? 1 : 0);
            log(`✅ Response received (HTTP ${response.status}). Records in this page: ${itemCount}`);

            if (Array.isArray(pageJson)) {
                const currentFirstItemId = pageJson.length > 0 ? (pageJson[0].id || pageJson[0].serial || pageJson[0].occurredAt || JSON.stringify(pageJson[0]).substring(0, 20)) : null;
                if (currentPageIndex > 1 && currentFirstItemId && currentFirstItemId === lastFirstItemId) {
                    log(`🛑 Duplicate data sequence detected (paging cursor may have looped). Halting pagination.`);
                    break; 
                }
                lastFirstItemId = currentFirstItemId;

                aggregatedData = aggregatedData.concat(pageJson);
                isPaginatedFlow = true;
            } else {
                aggregatedData = pageJson;
                break;
            }

            const linkHeader = response.headers.get('Link') || response.headers.get('link');
            targetUrl = null; 

            if (linkHeader && currentPageIndex < MAX_PAGE_SAFETY_LIMIT) {
                log(`🔗 Received Link Header: ${linkHeader}`);
                const links = linkHeader.split(',');
                for (let link of links) {
                    if (/rel=["']?next["']?/.test(link)) {
                        const match = link.match(/<([^>]+)>/);
                        if (match) {
                            let rawNextUrl = match[1];
                            try {
                                const urlObj = new URL(rawNextUrl);
                                urlObj.host = envDomain; 
                                targetUrl = urlObj.toString();
                            } catch (urlErr) {
                                targetUrl = rawNextUrl.replace(/https:\/\/[^\/]+/, `https://${envDomain}`);
                            }
                        }
                    }
                }
            } 
            else if (!linkHeader && pageJson.length > 0 && currentPageIndex < MAX_PAGE_SAFETY_LIMIT) {
                const lastItem = pageJson[pageJson.length - 1];
                const lastCursor = lastItem.id || lastItem.serial || lastItem.occurredAt || lastItem.networkId;
                
                if (lastCursor) {
                    log(`⚠️ CORS blocked headers or Link missing. Fallback -> Extracting cursor from last record: ${lastCursor}`);
                    try {
                        const urlObj = new URL(baseUrlWithoutCursor);
                        urlObj.searchParams.set('startingAfter', lastCursor);
                        targetUrl = urlObj.toString();
                    } catch (e) {
                        targetUrl = null;
                    }
                } else {
                    log(`🏁 No cursor found on last item or pagination completed.`);
                }
            } else {
                log(`🏁 Pagination completed successfully. No further pages.`);
            }
        }

        if (isPaginatedFlow && currentPageIndex > 1) {
            log(`✨ [Auto-pagination complete] Dispatched ${currentPageIndex} pages. Aggregated total: ${aggregatedData.length} records\n`);
        }
        
        rawResponseData = aggregatedData;
        
        // 1. Render JSON Tree
        renderJsonTree(aggregatedData, treeContainer);
        
        // 2. Setup dynamic table if list of objects
        if (Array.isArray(aggregatedData) && aggregatedData.length > 0 && typeof aggregatedData[0] === 'object') {
            currentTableData = aggregatedData.map(item => flattenObject(item));
            
            // Extract sorted headers
            const uniqueKeys = new Set();
            const scanLimit = Math.min(currentTableData.length, 20);
            for (let i = 0; i < scanLimit; i++) {
                Object.keys(currentTableData[i]).forEach(k => uniqueKeys.add(k));
            }
            tableHeaders = Array.from(uniqueKeys);
            const primaryFields = ['id', 'name', 'serial', 'mac', 'status', 'networkId', 'organizationId'];
            tableHeaders.sort((a, b) => {
                const idxA = primaryFields.indexOf(a);
                const idxB = primaryFields.indexOf(b);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            });
            
            renderTable(currentTableData, tableHeaders);
            document.getElementById('tab-table').style.display = 'inline-block';
        } else {
            document.getElementById('tab-table').style.display = 'none';
        }

    } catch (err) {
        log(`💣 Connection blocked: ${err.message}`);
        treeContainer.innerText = `Connection error. Unable to fetch data.\n(Please verify your browser is logged into ${envDomain} and your dashboard session is active)`;
    }
}



async function forceUpdateSpec() {
    const logBox = document.getElementById('debug-log');
    const updateBtn = document.getElementById('update-spec-btn');
    const badge = document.getElementById('spec-version-badge');
    if (!updateBtn) return;
    
    const originalText = updateBtn.innerText;
    updateBtn.innerText = '⏳ Downloading...';
    updateBtn.disabled = true;
    
    let debugLogs = `=======================================\n🔄 OpenAPI Spec Sync Triggered\n=======================================\n`;
    const log = (msg) => {
        debugLogs += `> ${msg}\n`;
        logBox.innerText = debugLogs;
        logBox.scrollTop = logBox.scrollHeight;
    };
    
    try {
        log("Fetching latest spec3.json from raw.githubusercontent.com...");
        const res = await fetch("https://raw.githubusercontent.com/meraki/openapi/master/openapi/spec3.json");
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
        log("Parsing spec JSON...");
        const spec = await res.json();
        
        log("Saving to local chrome storage...");
        await chrome.storage.local.set({ 'merakiSpec': spec });
        
        log("Caching successful. Rebuilding API layout...");
        globalSpec = spec;
        
        if (badge && globalSpec.info) {
            const apiVer = globalSpec.info.version || 'Unknown';
            const oasVer = globalSpec.openapi || '?';
            badge.innerText = `v${apiVer} (OAS ${oasVer})`;
            badge.style.display = 'inline-block';
        }
        
        buildDeepApiTree();
        renderCollapsibleTree();
        
        log("✅ API specification updated successfully!");
        updateBtn.innerText = '✅ Updated';
        setTimeout(() => {
            updateBtn.innerText = originalText;
            updateBtn.disabled = false;
        }, 2000);
    } catch (err) {
        log(`❌ Refresh failed: ${err.message}`);
        updateBtn.innerText = '❌ Failed';
        setTimeout(() => {
            updateBtn.innerText = originalText;
            updateBtn.disabled = false;
        }, 3000);
    }
}

function renderJsonTree(data, container) {
    container.innerHTML = '';
    if (data === null || data === undefined) {
        const nullNode = document.createElement('span');
        nullNode.className = 'json-val-null';
        nullNode.innerText = 'null';
        container.appendChild(nullNode);
        return;
    }
    const treeRoot = buildJsonTreeNode(data, '', true);
    container.appendChild(treeRoot);
}

function buildJsonTreeNode(val, key = '', isLast = true) {
    const nodeEl = document.createElement('div');
    nodeEl.className = 'json-node';
    
    let keySpan = null;
    if (key !== '') {
        keySpan = document.createElement('span');
        keySpan.className = 'json-key';
        keySpan.innerText = `"${key}": `;
    }
    
    const type = typeof val;
    
    if (val === null) {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-null';
        valSpan.innerText = 'null' + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (type === 'string') {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-string';
        valSpan.innerText = `"${val}"` + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (type === 'number') {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-number';
        valSpan.innerText = val + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (type === 'boolean') {
        if (keySpan) nodeEl.appendChild(keySpan);
        const valSpan = document.createElement('span');
        valSpan.className = 'json-val-boolean';
        valSpan.innerText = val + (isLast ? '' : ',');
        nodeEl.appendChild(valSpan);
    } else if (Array.isArray(val)) {
        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'json-toggle';
        toggleSpan.innerText = '▼ ';
        nodeEl.appendChild(toggleSpan);
        
        if (keySpan) nodeEl.appendChild(keySpan);
        
        const openBracket = document.createElement('span');
        openBracket.innerText = '[';
        nodeEl.appendChild(openBracket);
        
        const collapsedText = document.createElement('span');
        collapsedText.className = 'json-collapsed-text';
        collapsedText.innerText = ` ... ${val.length} items `;
        collapsedText.style.display = 'none';
        nodeEl.appendChild(collapsedText);
        
        const childrenContainer = document.createElement('div');
        childrenContainer.style.paddingLeft = '10px';
        
        val.forEach((item, idx) => {
            const childNode = buildJsonTreeNode(item, '', idx === val.length - 1);
            childrenContainer.appendChild(childNode);
        });
        nodeEl.appendChild(childrenContainer);
        
        const closeBracket = document.createElement('div');
        closeBracket.innerText = ']' + (isLast ? '' : ',');
        nodeEl.appendChild(closeBracket);
        
        toggleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = childrenContainer.style.display === 'none';
            if (isCollapsed) {
                childrenContainer.style.display = 'block';
                collapsedText.style.display = 'none';
                toggleSpan.innerText = '▼ ';
                toggleSpan.classList.remove('collapsed');
            } else {
                childrenContainer.style.display = 'none';
                collapsedText.style.display = 'inline';
                toggleSpan.innerText = '▶ ';
                toggleSpan.classList.add('collapsed');
            }
        });
        
    } else if (type === 'object') {
        const toggleSpan = document.createElement('span');
        toggleSpan.className = 'json-toggle';
        toggleSpan.innerText = '▼ ';
        nodeEl.appendChild(toggleSpan);
        
        if (keySpan) nodeEl.appendChild(keySpan);
        
        const openBrace = document.createElement('span');
        openBrace.innerText = '{';
        nodeEl.appendChild(openBrace);
        
        const keys = Object.keys(val);
        const collapsedText = document.createElement('span');
        collapsedText.className = 'json-collapsed-text';
        collapsedText.innerText = ` ... ${keys.length} keys `;
        collapsedText.style.display = 'none';
        nodeEl.appendChild(collapsedText);
        
        const childrenContainer = document.createElement('div');
        childrenContainer.style.paddingLeft = '10px';
        
        keys.forEach((k, idx) => {
            const childNode = buildJsonTreeNode(val[k], k, idx === keys.length - 1);
            childrenContainer.appendChild(childNode);
        });
        nodeEl.appendChild(childrenContainer);
        
        const closeBrace = document.createElement('div');
        closeBrace.innerText = '}' + (isLast ? '' : ',');
        nodeEl.appendChild(closeBrace);
        
        toggleSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = childrenContainer.style.display === 'none';
            if (isCollapsed) {
                childrenContainer.style.display = 'block';
                collapsedText.style.display = 'none';
                toggleSpan.innerText = '▼ ';
                toggleSpan.classList.remove('collapsed');
            } else {
                childrenContainer.style.display = 'none';
                collapsedText.style.display = 'inline';
                toggleSpan.innerText = '▶ ';
                toggleSpan.classList.add('collapsed');
            }
        });
    }
    
    return nodeEl;
}

function flattenObject(obj, prefix = '') {
    const flat = {};
    for (const key in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const val = obj[key];
        const newKey = prefix ? `${prefix}.${key}` : key;
        
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(flat, flattenObject(val, newKey));
        } else {
            flat[newKey] = val;
        }
    }
    return flat;
}

function renderTable(flatData, headers) {
    const table = document.getElementById('data-result-table');
    table.innerHTML = '';
    
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        th.innerText = h;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    const tbody = document.createElement('tbody');
    flatData.forEach((row, rowIdx) => {
        const tr = document.createElement('tr');
        tr.id = `table-row-${rowIdx}`;
        
        headers.forEach(h => {
            const td = document.createElement('td');
            const val = row[h];
            let copyText = '';
            if (val === undefined || val === null) {
                td.innerText = '';
            } else if (typeof val === 'object') {
                if (Array.isArray(val)) {
                    if (val.length === 0) {
                        td.innerText = '';
                        td.title = '[] (Double-click to copy)';
                        copyText = '[]';
                    } else {
                        const allPrimitives = val.every(item => item === null || typeof item !== 'object');
                        if (allPrimitives) {
                            const joined = val.map(item => item === null ? 'null' : String(item)).join(', ');
                            td.innerText = joined;
                            td.title = `${joined} (Double-click to copy)`;
                            copyText = joined;
                        } else {
                            const str = JSON.stringify(val);
                            let displayed = str;
                            if (str.length > 100) {
                                displayed = str.substring(0, 100) + '...';
                            }
                            td.innerText = displayed;
                            td.title = `${str}\n\n(Double-click to copy)`;
                            copyText = str;
                        }
                    }
                } else {
                    const str = JSON.stringify(val);
                    let displayed = str;
                    if (str.length > 100) {
                        displayed = str.substring(0, 100) + '...';
                    }
                    td.innerText = displayed;
                    td.title = `${str}\n\n(Double-click to copy)`;
                    copyText = str;
                }
            } else {
                const str = String(val);
                td.innerText = str;
                td.title = `${str} (Double-click to copy)`;
                copyText = str;
            }

            if (copyText) {
                td.addEventListener('dblclick', () => {
                    navigator.clipboard.writeText(copyText).then(() => {
                        td.classList.add('copied-cell');
                        setTimeout(() => {
                            td.classList.remove('copied-cell');
                        }, 800);
                    });
                });
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
}

function handleTableSearch(e) {
    const keyword = e.target.value.trim().toLowerCase();
    
    currentTableData.forEach((row, idx) => {
        const tr = document.getElementById(`table-row-${idx}`);
        if (!tr) return;
        
        if (!keyword) {
            tr.style.display = '';
            return;
        }
        
        const matches = Object.values(row).some(val => {
            if (val === null || val === undefined) return false;
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return strVal.toLowerCase().includes(keyword);
        });
        
        tr.style.display = matches ? '' : 'none';
    });
}

function exportToCsv() {
    if (currentTableData.length === 0) return;
    
    const keyword = document.getElementById('table-search').value.trim().toLowerCase();
    const filteredData = currentTableData.filter(row => {
        if (!keyword) return true;
        return Object.values(row).some(val => {
            if (val === null || val === undefined) return false;
            const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return strVal.toLowerCase().includes(keyword);
        });
    });
    
    if (filteredData.length === 0) {
        alert("No visible data rows to export.");
        return;
    }
    
    let csvContent = tableHeaders.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';
    
    filteredData.forEach(row => {
        const rowStr = tableHeaders.map(h => {
            let val = row[h];
            if (val === undefined || val === null) {
                return '""';
            }
            if (typeof val === 'object') {
                val = JSON.stringify(val);
            }
            return `"${String(val).replace(/"/g, '""')}"`;
        }).join(',');
        csvContent += rowStr + '\n';
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const envDomain = document.getElementById('env-select').value;
    const cleanPath = currentSelectedApi ? currentSelectedApi.path.replace(/\//g, '_').replace(/[{}]/g, '') : 'export';
    link.setAttribute('download', `${envDomain}${cleanPath}_export.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}