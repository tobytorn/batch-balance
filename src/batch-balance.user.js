// ==UserScript==
// @name        Batch Balance
// @namespace   https://github.com/tobytorn
// @description 帮派调账工具 (不支持移动版网页)
// @author      tobytorn [1617955]
// @match       https://www.torn.com/factions.php?step=your*
// @version     1.0.1-dev
// @grant       GM_getValue
// @grant       GM.getValue
// @grant       GM_setValue
// @grant       GM.setValue
// @supportURL  https://github.com/tobytorn/batch-balance
// @license     MIT
// @require     https://unpkg.com/jquery@3.7.0/dist/jquery.min.js
// ==/UserScript==

// 使用说明：
// 在调账界面 URL (https://www.torn.com/factions.php?step=your#/tab=controls) 的 # 之后添加如下参数以开启批量调账
// batbal_uids    逗号分隔的用户 ID
// batbal_amounts 逗号分隔的调账金额
//
// 例如: 下边这个 URL 会给 bingri 增加 120，给 tobytorn 减少 250，给 Duke 增加 1.5k
//   https://www.torn.com/factions.php?step=your#/tab=controls&batbal_uids=1523812,1617955,4&batbal_amounts=120,-250,1500

'use strict';

const OC_TAX = 0;
const GM_VALUE_KEY = 'batbal-action';
const PROFILE_HREF_PREFIX = 'profiles.php?XID=';

const $ = window.jQuery;
if (GM) {
  window.GM_getValue = GM.getValue;
  window.GM_setValue = GM.setValue;
}

function addStyle(css) {
  const STYLE_ID = 'BATBAL-GLOBAL-STYLE';
  const style =
    document.getElementById(STYLE_ID) ||
    (function () {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
      return style;
    })();
  css.split(/}\s*\n/).forEach((s) => {
    if (s.trim()) {
      style.sheet.insertRule(s + '}');
    }
  });
}

addStyle(`
  .batbal-focus-btn {
    border: 2px solid red !important;
  }
  .batbal-overlay {
    position: relative;
  }
  .batbal-overlay:after {
    content: '';
    position: absolute;
    background: repeating-linear-gradient(135deg, #2228, #2228 70px, #0008 70px, #0008 80px);
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 900000;
  }
`);

addStyle(`
  #batbal-ctrl {
    margin: 10px 0;
    padding: 10px;
    background-color: #f2f2f2;
    border-radius: 5px;
    background-color: var(--default-bg-panel-color);
    text-align: center;
    line-height: 16px;
  }
  #batbal-ctrl-detail-link,
  #batbal-ctrl > :not(:first-child) {
    margin-top: 10px;
  }
  #batbal-ctrl-title {
    font-size: large;
    font-weight: bold;
  }
  #batbal-ctrl-status {
    font-weight: bold;
  }
  #batbal-ctrl button {
    margin: 0 4px;
  }
  #batbal-ctrl th {
    font-weight: bold;
  }
  #batbal-ctrl th,
  #batbal-ctrl td {
    padding: 5px;
    border: 1px solid #ccc;
  }
  #batbal-ctrl td:last-child {
    text-align: right;
  }
  #batbal-ctrl-detail tr.batbal-done:after {
    content: '\u2713';
    color: green;
    padding-left: 6px;
  }
  #batbal-ctrl-tab {
    cursor: pointer;
  }
`);

const CONTROLLER_HTML = `
  <div id="batbal-ctrl">
    <div id="batbal-ctrl-title">批量调账</div>
    <div id="batbal-ctrl-detail" style="display: none">
      <table style="margin: auto">
        <thead>
          <tr>
            <th><span class="batbal-ctrl-detail-cached" style="display: none">缓存</span>ID</th>
            <th><span class="batbal-ctrl-detail-cached" style="display: none">缓存</span>Name</th>
            <th><span class="batbal-ctrl-detail-cached" style="display: none">缓存</span>金额</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <div id="batbal-ctrl-detail-link" style="display: none">
        <a target="_blank">点击这里继续进行缓存中的调账</a>
      </div>
    </div>
    <div id="batbal-ctrl-summary"></div>
    <div>
      <button id="batbal-ctrl-start" class="torn-btn" disabled>开始调账</button>
      <button id="batbal-ctrl-show-detail" class="torn-btn">显示详情</button>
      <button id="batbal-ctrl-hide-detail" class="torn-btn" style="display: none">隐藏详情</button>
      <button id="batbal-ctrl-clear-cache" class="torn-btn" disabled>清除缓存</button>
    </div>
    <div>当前状态: <span id="batbal-ctrl-status"></span></div>
  </div>`;

function formatAmount(v) {
  return (v >= 0 ? '+' : '') + v.toString().replace(/\d{1,3}(?=(\d{3})+$)/g, (s) => s + ',');
}

async function sleep(t) {
  await new Promise((r) => setTimeout(r, t));
}

function renderLinkOnOcPage() {
  const URL_PREFIX = 'https://www.torn.com/factions.php?step=your#/tab=crimes&';
  if (!location.href.startsWith(URL_PREFIX)) {
    return;
  }
  const params = new URLSearchParams(location.href.slice(URL_PREFIX.length));
  const crimeId = params.get('crimeID');
  if (crimeId === null) {
    return;
  }
  const interval = setInterval(function () {
    const $title = $('.organize-wrap div[role="heading"]');
    if ($title.length === 0) {
      return;
    }
    clearInterval(interval);
    const $income = $('.organize-wrap .success .make-wrap').last();
    const incomeMatch = ($income.text() || '').match(/\$([\d,]+) made/i);
    const $userLinks = $income.nextAll().find(`a[href*="${PROFILE_HREF_PREFIX}"]`);
    if (!incomeMatch || $userLinks.length === 0) {
      return;
    }
    const income = parseInt(incomeMatch[1].replace(/,/g, ''));
    const uids = $userLinks
      .map(function () {
        return $(this).attr('href').split(PROFILE_HREF_PREFIX)[1];
      })
      .get();
    const url =
      `https://www.torn.com/factions.php?step=your#/tab=controls` +
      `&batbal_uids=${uids.join(',')}&batbal_amounts=${new Array(uids.length)
        .fill(((income * (1 - OC_TAX)) / uids.length).toFixed(0))
        .join(',')}`;
    $income.append(`<p><a href="${url}" target="_blank">去调账</a></p>`);
  }, 1000);
}

function parseAction(params) {
  const paramUids = params.get('batbal_uids');
  const paramAmounts = params.get('batbal_amounts');
  if (!paramUids || !paramAmounts) {
    throw new Error('请提供参数 batbal_uids 和 batbal_amounts 以开始调账');
  }
  const uids = paramUids.split(',');
  const amounts = paramAmounts.split(',');
  if (uids.some((x) => !x.match(/^\d+$/))) {
    throw new Error('参数 batbal_uids 不合法');
  }
  if (amounts.some((x) => !x.match(/^[+-]?\d{1,11}$/)) || amounts.length < uids.length) {
    throw new Error('参数 batbal_amounts 不合法');
  }
  return {
    uidAmounts: uids.map((uid, i) => [uid, parseInt(amounts[i])]).filter(([, amount]) => amount !== 0),
    next: 0,
  };
}

function updateStatus(s) {
  $('#batbal-ctrl-status').text(s);
  if (s instanceof Error) {
    $('#batbal-ctrl-status').css('color', 'red');
  }
}

function getParams() {
  const URL_PREFIX = 'https://www.torn.com/factions.php?step=your#/tab=controls';
  if (!location.href.startsWith(URL_PREFIX)) {
    return;
  }
  return new URLSearchParams(location.href.slice(URL_PREFIX.length + 1));
}

async function renderController(params) {
  const storedAction = await GM_getValue(GM_VALUE_KEY, null);
  const $controlsWrap = $('.faction-controls-wrap');
  $controlsWrap.before(CONTROLLER_HTML);
  $('#batbal-ctrl-show-detail').on('click', function () {
    $('#batbal-ctrl-detail').show();
    $('#batbal-ctrl-hide-detail').show();
    $(this).hide();
  });
  $('#batbal-ctrl-hide-detail').on('click', function () {
    $('#batbal-ctrl-detail').hide();
    $('#batbal-ctrl-show-detail').show();
    $(this).hide();
  });
  $('#batbal-ctrl-clear-cache').on('click', async function () {
    if (confirm('确认删除缓存中的调账数据吗？该操作无法撤销')) {
      await storeAction(null);
      alert('缓存已删除，请刷新页面');
    }
  });
  if (storedAction === null && (params.get('batbal_uids') === null || params.get('batbal_amounts') === null)) {
    $('#batbal-ctrl').hide();
  }
  $controlsWrap.find('.control-tabs').append('<li><a id="batbal-ctrl-tab">批量调账</a></li>');
  $('#batbal-ctrl-tab').on('click', async function () {
    $('#batbal-ctrl').show();
  });
  if (storedAction) {
    $('#batbal-ctrl-clear-cache').removeAttr('disabled');
  }
}

async function checkAction(action) {
  const storedAction = await GM_getValue(GM_VALUE_KEY, null);
  if (storedAction) {
    // Compare action and storedAction
    if (JSON.stringify(action.uidAmounts) !== JSON.stringify(storedAction.uidAmounts)) {
      throw new Error('缓存中有未完成的其他调账记录，与当前 URL 中的信息不符，点击 "查看详情" 以显示缓存数据');
    } else {
      action.next = storedAction.next;
      updateStatus(`根据缓存记录，之前已完成 ${action.next} / ${action.uidAmounts.length} 人`);
    }
  } else {
    updateStatus('准备就绪');
  }
}

async function storeAction(action) {
  await GM_setValue(GM_VALUE_KEY, action);
}

async function getUidNameMap() {
  return new Promise((resolve) => {
    const interval = setInterval(function () {
      const $depositors = $('.money-wrap .user-info-list-wrap .depositor');
      if ($depositors.length === 0) {
        return;
      }
      const map = {};
      $depositors.each(function () {
        const $name = $(this).find(`a[href*="${PROFILE_HREF_PREFIX}"]`).first();
        if ($name.length > 0) {
          const uid = ($name.attr('href') || '').split(PROFILE_HREF_PREFIX)[1];
          map[uid] = $name.text().trim();
        }
      });
      clearInterval(interval);
      resolve(map);
    }, 2000);
  });
}

function renderDetails(action, uidNameMap) {
  const $tbody = $('#batbal-ctrl-detail tbody');
  $tbody.empty();
  action.uidAmounts.forEach(([uid, amount], i) => {
    const amountClass = amount >= 0 ? 't-green' : 't-red';
    const trClass = i < action.next ? 'batbal-done' : '';
    const name = uidNameMap[uid] || '';
    $tbody.append(
      `<tr class="${trClass}"><td>${uid}</td><td>${name}</td><td class="${amountClass}">${formatAmount(amount)}</td>`,
    );
  });
  const total = action.uidAmounts.reduce((v, [, amount]) => v + amount, 0);
  const totalClass = total >= 0 ? 't-green' : 't-red';
  $('#batbal-ctrl-summary').html(`
    总人数: ${action.uidAmounts.length},
    总金额: <span class="${totalClass}">${formatAmount(total)}</span>
  `);
}

async function addMoney(uid, name, diff) {
  const $giveBlock = $('.money-wrap .give-block');
  $giveBlock.find('input#money-user').val(`${name} [${uid}]`);
  $giveBlock.find('.input-money-group input').val(diff);
  $giveBlock.find('#add-to-balance-money').trigger('click');
  $giveBlock.find('button').addClass('batbal-focus-btn').removeClass('disabled').removeAttr('disabled');
  return new Promise((resolve, reject) => {
    const resultObserver = new MutationObserver(function () {
      const $result = $giveBlock.find('.result span.msg-result');
      if ($result.length > 0 && $result.is(':visible')) {
        resultObserver.disconnect();
        $giveBlock.find('button').removeClass('batbal-focus-btn');
        if ($result.hasClass('t-green')) {
          resolve();
        } else {
          reject(new Error(`调账时收到系统错误消息: ${$result.text()}`));
        }
      }
    });
    resultObserver.observe($giveBlock[0], { childList: true, subtree: true });
  });
}

async function closePrompt($parent) {
  const MAX_DELAY = 1000;
  const DELAY_INCREMENT = 100;
  let delay = 0;
  // 关闭调账结果 (不知为何，有时需要多次尝试才能成功关闭)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    delay = Math.min(delay + DELAY_INCREMENT, MAX_DELAY);
    await sleep(delay);
    const $okay = $parent.find('.give-block .result a.okay');
    if ($okay.length === 0 || !$okay.is(':visible')) {
      break;
    }
    $okay[0].click();
  }
}

async function start(action, uidNameMap) {
  try {
    $('.faction-controls-wrap .control-tabs').addClass('batbal-overlay');
    $('.faction-controls-wrap .point-wrap').addClass('batbal-overlay');
    const $moneyWrap = $('.faction-controls-wrap .money-wrap');
    $moneyWrap.find('.give-block label[for="give-money"]').hide();
    $('#batbal-ctrl-start').attr('disabled', true);
    $('#batbal-ctrl-clear-cache').attr('disabled', true);
    // Move the "CONFIRM" button to the same position as the "ADD MONEY" button
    $moneyWrap.find('.give-block').css('position', 'relative');
    $moneyWrap
      .find('.give-block .action-confirm .btn-wrap')
      .css('position', 'absolute')
      .css('right', '0')
      .css('bottom', '10px');

    while (action.next < action.uidAmounts.length) {
      updateStatus(`请确认第 ${action.next + 1} 个人的调账，共计 ${action.uidAmounts.length} 人`);
      const [uid, amount] = action.uidAmounts[action.next];
      const name = uidNameMap[uid] || '未知玩家';
      await addMoney(uid, name, amount);
      action.next++;
      await storeAction(action);
      await closePrompt($moneyWrap);
    }

    $moneyWrap.addClass('batbal-overlay');
    await storeAction(null);
    updateStatus('调账完成！');
  } catch (err) {
    updateStatus(err);
  }
}

async function main() {
  try {
    renderLinkOnOcPage();

    const params = getParams();
    if (!params) {
      return;
    }
    const uidNameMap = await getUidNameMap();
    await renderController(params);

    const storedAction = await GM_getValue(GM_VALUE_KEY, null);
    if (storedAction) {
      $('#batbal-ctrl-detail-link').show();
      $('.batbal-ctrl-detail-cached').show();
      renderDetails(storedAction, uidNameMap);
      const storedUids = storedAction.uidAmounts.map(([uid]) => uid);
      const storedAmounts = storedAction.uidAmounts.map(([, amount]) => amount);
      const url =
        `https://www.torn.com/factions.php?step=your#/tab=controls` +
        `&batbal_uids=${storedUids.join(',')}&batbal_amounts=${storedAmounts.join(',')}`;
      $('#batbal-ctrl-detail-link a').attr('href', url);
    }

    const action = parseAction(params);
    await checkAction(action);
    $('#batbal-ctrl-detail-link').hide();
    $('.batbal-ctrl-detail-cached').hide();
    renderDetails(action, uidNameMap);
    $('#batbal-ctrl-start').removeAttr('disabled');
    $('#batbal-ctrl-start').on('click', () => start(action, uidNameMap));
  } catch (err) {
    updateStatus(err);
  }
}

main();
