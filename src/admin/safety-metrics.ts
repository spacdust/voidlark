import { getAllCircuitBreakers } from '../ai/circuit-breaker.js';
import { getTokenLimiter } from '../ai/token-limiter.js';

/**
 * Admin endpoint to get AI safety metrics (Fase 8)
 * Returns circuit breaker status, token usage, and cost stats
 */
export const getSafetyMetrics = () => {
    const circuitBreakers = getAllCircuitBreakers();
    const tokenLimiter = getTokenLimiter();
    const costStats = tokenLimiter.getStats();
    
    return {
        timestamp: new Date().toISOString(),
        circuitBreakers,
        tokenUsage: {
            totalRequests: costStats.totalRequests,
            totalTokens: costStats.totalTokens,
            promptTokens: costStats.totalPromptTokens,
            completionTokens: costStats.totalCompletionTokens,
        },
        costs: {
            totalUSD: costStats.totalCostUSD.toFixed(4),
            lastHourUSD: costStats.lastHourCostUSD.toFixed(4),
            lastDayUSD: costStats.lastDayCostUSD.toFixed(4),
        },
        health: {
            allCircuitsClosed: Object.values(circuitBreakers).every(cb => cb.state === 'CLOSED'),
            anyCircuitOpen: Object.values(circuitBreakers).some(cb => cb.state === 'OPEN'),
            totalFailures: Object.values(circuitBreakers).reduce((sum, cb) => sum + cb.totalFailures, 0),
        },
    };
};

/**
 * Format safety metrics as HTML for admin UI
 */
export const renderSafetyMetricsHTML = () => {
    const metrics = getSafetyMetrics();
    
    const circuitBreakersHTML = Object.entries(metrics.circuitBreakers)
        .map(([name, stats]) => {
            const stateColor = stats.state === 'CLOSED' ? 'green' : stats.state === 'OPEN' ? 'red' : 'orange';
            const stateEmoji = stats.state === 'CLOSED' ? '✅' : stats.state === 'OPEN' ? '🔴' : '⚠️';
            return `
                <div style="border: 1px solid #ddd; padding: 12px; margin: 8px 0; border-radius: 6px;">
                    <h4 style="margin: 0 0 8px 0;">${stateEmoji} ${name}</h4>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 13px;">
                        <div><strong>State:</strong> <span style="color: ${stateColor}; font-weight: bold;">${stats.state}</span></div>
                        <div><strong>Total Requests:</strong> ${stats.totalRequests}</div>
                        <div><strong>Total Failures:</strong> ${stats.totalFailures}</div>
                        <div><strong>Failure Rate:</strong> ${stats.totalRequests > 0 ? ((stats.totalFailures / stats.totalRequests) * 100).toFixed(2) : 0}%</div>
                        ${stats.lastFailureTime ? `<div><strong>Last Failure:</strong> ${new Date(stats.lastFailureTime).toLocaleString('id-ID')}</div>` : ''}
                        <div><strong>Last State Change:</strong> ${new Date(stats.lastStateChange).toLocaleString('id-ID')}</div>
                    </div>
                </div>
            `;
        })
        .join('');
    
    const healthStatus = metrics.health.allCircuitsClosed ? 
        '<span style="color: green; font-weight: bold;">✅ HEALTHY</span>' : 
        '<span style="color: red; font-weight: bold;">⚠️ DEGRADED</span>';
    
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>AI Safety Metrics - Voidlark</title>
            <style>
                * { box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background: #f5f5f5;
                }
                .container {
                    max-width: 1000px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 8px;
                    padding: 24px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                h1 { margin: 0 0 8px 0; color: #333; }
                .subtitle { color: #666; margin: 0 0 24px 0; }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                    margin: 24px 0;
                }
                .stat-card {
                    background: #f9f9f9;
                    padding: 16px;
                    border-radius: 6px;
                    border: 1px solid #e0e0e0;
                }
                .stat-card h3 {
                    margin: 0 0 8px 0;
                    font-size: 14px;
                    color: #666;
                    font-weight: 500;
                }
                .stat-card .value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #333;
                }
                .section {
                    margin: 32px 0;
                }
                .section h2 {
                    margin: 0 0 16px 0;
                    color: #333;
                    font-size: 20px;
                }
                .refresh-btn {
                    background: #007bff;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                }
                .refresh-btn:hover {
                    background: #0056b3;
                }
                .back-link {
                    display: inline-block;
                    margin-bottom: 16px;
                    color: #007bff;
                    text-decoration: none;
                }
                .back-link:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <a href="/admin" class="back-link">← Kembali ke Admin</a>
                
                <h1>AI Safety Metrics</h1>
                <p class="subtitle">
                    Status: ${healthStatus} | 
                    Last Updated: ${new Date(metrics.timestamp).toLocaleString('id-ID')}
                    <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
                </p>
                
                <div class="section">
                    <h2>💰 Token Usage & Costs</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h3>Total Requests</h3>
                            <div class="value">${metrics.tokenUsage.totalRequests.toLocaleString()}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Total Tokens</h3>
                            <div class="value">${metrics.tokenUsage.totalTokens.toLocaleString()}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Total Cost</h3>
                            <div class="value">$${metrics.costs.totalUSD}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Last Hour Cost</h3>
                            <div class="value">$${metrics.costs.lastHourUSD}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Last Day Cost</h3>
                            <div class="value">$${metrics.costs.lastDayUSD}</div>
                        </div>
                        <div class="stat-card">
                            <h3>Avg Cost/Request</h3>
                            <div class="value">$${(parseFloat(metrics.costs.totalUSD) / Math.max(metrics.tokenUsage.totalRequests, 1)).toFixed(4)}</div>
                        </div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>🔌 Circuit Breakers</h2>
                    ${circuitBreakersHTML || '<p style="color: #666;">No circuit breakers active yet.</p>'}
                </div>
                
                <div class="section">
                    <h2>📊 Token Distribution</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h3>Prompt Tokens</h3>
                            <div class="value">${metrics.tokenUsage.promptTokens.toLocaleString()}</div>
                            <p style="font-size: 12px; color: #666; margin: 4px 0 0 0;">
                                ${metrics.tokenUsage.totalTokens > 0 ? ((metrics.tokenUsage.promptTokens / metrics.tokenUsage.totalTokens) * 100).toFixed(1) : 0}% of total
                            </p>
                        </div>
                        <div class="stat-card">
                            <h3>Completion Tokens</h3>
                            <div class="value">${metrics.tokenUsage.completionTokens.toLocaleString()}</div>
                            <p style="font-size: 12px; color: #666; margin: 4px 0 0 0;">
                                ${metrics.tokenUsage.totalTokens > 0 ? ((metrics.tokenUsage.completionTokens / metrics.tokenUsage.totalTokens) * 100).toFixed(1) : 0}% of total
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
};
