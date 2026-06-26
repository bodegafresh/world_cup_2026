/**
 * BackendCronOrchestration.gs
 *
 * Scheduler liviano GAS -> FastAPI.
 * GAS no ingesta datos ni llama Supabase: solo despierta y orquesta el backend.
 */

const MATCH_ALPHA_CRON_CONFIG = {
  BACKEND_BASE_URL: 'https://YOUR_RENDER_SERVICE.onrender.com',
  API_INTERNAL_KEY: 'SET_IN_SCRIPT_PROPERTIES',
  MAX_FETCH_PER_DAY: 80,
  KEEPALIVE_ENABLED: true,
  DAILY_JOB_ENABLED: true,
  LIVE_JOB_ENABLED: true,
  FETCH_TIMEOUT_MS: 30000
};

const MATCH_ALPHA_CRON_PROPS = {
  FETCH_COUNT: 'MATCH_ALPHA_FETCH_COUNT',
  FETCH_COUNT_DATE: 'MATCH_ALPHA_FETCH_COUNT_DATE',
  LAST_STATUS: 'MATCH_ALPHA_LAST_BACKEND_STATUS',
  TRIGGER_PREFIX: 'MATCH_ALPHA_BACKEND_TRIGGER_'
};

function backendFetch_(path, options) {
  options = options || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { ok: false, skipped: true, reason: 'LOCK_BUSY', timestamp: new Date().toISOString() };
  }

  try {
    if (!canUseFetch_()) {
      return { ok: false, skipped: true, reason: 'FETCH_DAILY_LIMIT_REACHED', timestamp: new Date().toISOString() };
    }

    const config = getBackendCronConfig_();
    const url = config.BACKEND_BASE_URL.replace(/\/+$/g, '') + path;
    const params = {
      method: options.method || 'get',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + config.API_INTERNAL_KEY
      }
    };
    if (options.payload) params.payload = JSON.stringify(options.payload);

    incrementFetchCounter_();
    let response;
    try {
      response = UrlFetchApp.fetch(url, params);
    } catch (firstError) {
      Utilities.sleep(1000);
      if (!canUseFetch_()) throw firstError;
      incrementFetchCounter_();
      response = UrlFetchApp.fetch(url, params);
    }

    const statusCode = response.getResponseCode();
    const text = response.getContentText();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch (parseError) {
      body = { raw: text };
    }

    const result = {
      ok: statusCode >= 200 && statusCode < 300,
      status_code: statusCode,
      data: body,
      timestamp: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty(MATCH_ALPHA_CRON_PROPS.LAST_STATUS, JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function incrementFetchCounter_() {
  resetDailyFetchCounterIfNeeded_();
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty(MATCH_ALPHA_CRON_PROPS.FETCH_COUNT) || 0) + 1;
  props.setProperty(MATCH_ALPHA_CRON_PROPS.FETCH_COUNT, String(count));
  return count;
}

function canUseFetch_() {
  resetDailyFetchCounterIfNeeded_();
  const config = getBackendCronConfig_();
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty(MATCH_ALPHA_CRON_PROPS.FETCH_COUNT) || 0);
  return count < Number(config.MAX_FETCH_PER_DAY || 80);
}

function resetDailyFetchCounterIfNeeded_() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd');
  const storedDate = props.getProperty(MATCH_ALPHA_CRON_PROPS.FETCH_COUNT_DATE);
  if (storedDate !== today) {
    props.setProperty(MATCH_ALPHA_CRON_PROPS.FETCH_COUNT_DATE, today);
    props.setProperty(MATCH_ALPHA_CRON_PROPS.FETCH_COUNT, '0');
  }
}

function pingBackendKeepAlive() {
  const config = getBackendCronConfig_();
  if (!config.KEEPALIVE_ENABLED) return { ok: false, skipped: true, reason: 'KEEPALIVE_DISABLED' };
  return backendFetch_('/api/v1/jobs/orchestrate/keepalive', { method: 'post', payload: { source: 'gas_keepalive' } });
}

function runDailyBackendOrchestration() {
  const config = getBackendCronConfig_();
  if (!config.DAILY_JOB_ENABLED) return { ok: false, skipped: true, reason: 'DAILY_JOB_DISABLED' };
  return backendFetch_('/api/v1/jobs/orchestrate/daily', { method: 'post', payload: { source: 'gas_daily' } });
}

function runLiveBackendOrchestration() {
  const config = getBackendCronConfig_();
  if (!config.LIVE_JOB_ENABLED) return { ok: false, skipped: true, reason: 'LIVE_JOB_DISABLED' };
  return backendFetch_('/api/v1/jobs/orchestrate/live', { method: 'post', payload: { source: 'gas_live' } });
}

function checkBackendLatestStatus() {
  return backendFetch_('/api/v1/jobs/status/latest', { method: 'get' });
}

function installMatchAlphaTriggers() {
  removeMatchAlphaTriggers();

  const keepalive = ScriptApp.newTrigger('pingBackendKeepAlive')
    .timeBased()
    .everyMinutes(30)
    .create();

  const daily = ScriptApp.newTrigger('runDailyBackendOrchestration')
    .timeBased()
    .atHour(7)
    .everyDays(1)
    .create();

  const live = ScriptApp.newTrigger('runLiveBackendOrchestration')
    .timeBased()
    .everyMinutes(30)
    .create();

  const props = PropertiesService.getScriptProperties();
  props.setProperty(MATCH_ALPHA_CRON_PROPS.TRIGGER_PREFIX + 'KEEPALIVE', keepalive.getUniqueId());
  props.setProperty(MATCH_ALPHA_CRON_PROPS.TRIGGER_PREFIX + 'DAILY', daily.getUniqueId());
  props.setProperty(MATCH_ALPHA_CRON_PROPS.TRIGGER_PREFIX + 'LIVE', live.getUniqueId());

  return {
    ok: true,
    keepalive_trigger_id: keepalive.getUniqueId(),
    daily_trigger_id: daily.getUniqueId(),
    live_trigger_id: live.getUniqueId()
  };
}

function removeMatchAlphaTriggers() {
  const handlers = {
    pingBackendKeepAlive: true,
    runDailyBackendOrchestration: true,
    runLiveBackendOrchestration: true,
    checkBackendLatestStatus: true
  };

  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const props = PropertiesService.getScriptProperties();
  Object.keys(MATCH_ALPHA_CRON_PROPS).forEach(function(key) {
    const propName = MATCH_ALPHA_CRON_PROPS[key];
    if (propName.indexOf('MATCH_ALPHA_BACKEND_TRIGGER_') === 0) {
      props.deleteProperty(propName + 'KEEPALIVE');
      props.deleteProperty(propName + 'DAILY');
      props.deleteProperty(propName + 'LIVE');
    }
  });

  return { ok: true, removed: true };
}

function getBackendCronConfig_() {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty('BACKEND_BASE_URL') || MATCH_ALPHA_CRON_CONFIG.BACKEND_BASE_URL;
  const key = props.getProperty('API_INTERNAL_KEY') || MATCH_ALPHA_CRON_CONFIG.API_INTERNAL_KEY;
  return Object.assign({}, MATCH_ALPHA_CRON_CONFIG, {
    BACKEND_BASE_URL: baseUrl,
    API_INTERNAL_KEY: key,
    MAX_FETCH_PER_DAY: Number(props.getProperty('MAX_FETCH_PER_DAY') || MATCH_ALPHA_CRON_CONFIG.MAX_FETCH_PER_DAY),
    KEEPALIVE_ENABLED: readBooleanProperty_('KEEPALIVE_ENABLED', MATCH_ALPHA_CRON_CONFIG.KEEPALIVE_ENABLED),
    DAILY_JOB_ENABLED: readBooleanProperty_('DAILY_JOB_ENABLED', MATCH_ALPHA_CRON_CONFIG.DAILY_JOB_ENABLED),
    LIVE_JOB_ENABLED: readBooleanProperty_('LIVE_JOB_ENABLED', MATCH_ALPHA_CRON_CONFIG.LIVE_JOB_ENABLED)
  });
}

function readBooleanProperty_(key, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}
