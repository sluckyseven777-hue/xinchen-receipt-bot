/******************************************************************
 * XINCHEN RECEIPT BOT V1.0
 * 鑫財團簡易加賬機器人
 *
 * SG  Channel: 1536956205803503686
 * IRL Channel: 1555181833816117359
 *
 * Functions:
 * - Pure amount receipt
 * - SG / IRL separated
 * - Daily summary
 * - Reply + void/cancel/撤銷/撤销
 * - Ignore message edits
 * - Message ID dedupe handled by Apps Script
 * - Bilingual Chinese / English
 * - Render health server
 ******************************************************************/

const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder
} = require('discord.js');


/******************************************************************
 * ENVIRONMENT VARIABLES
 ******************************************************************/

const TOKEN = process.env.TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!TOKEN) {
  console.error('[BOOT ERROR] TOKEN is missing.');
  process.exit(1);
}

if (!APPS_SCRIPT_URL) {
  console.error('[BOOT ERROR] APPS_SCRIPT_URL is missing.');
  process.exit(1);
}


/******************************************************************
 * CONFIG
 ******************************************************************/

const VERSION = 'XINCHEN RECEIPT BOT V1.0';

const CHANNELS = {
  '1536956205803503686': 'XINCHEN-SG',
  '1555181833816117359': 'XINCHEN-IRL'
};

const VOID_WORDS = new Set([
  'void',
  'cancel',
  '撤销',
  '撤銷'
]);

const MAX_SUMMARY_ENTRIES = 25;


/******************************************************************
 * DISCORD CLIENT
 ******************************************************************/

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});


/******************************************************************
 * RENDER HTTP SERVER
 ******************************************************************/

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end(
    `XINCHEN Receipt Bot is running.\n${VERSION}`
  );

});

server.listen(PORT, '0.0.0.0', () => {

  console.log(
    `[HTTP] listening: ${PORT}`
  );

});


/******************************************************************
 * READY
 ******************************************************************/

client.once(Events.ClientReady, readyClient => {

  console.log(
    `[BOOT] ${VERSION}`
  );

  console.log(
    `[GATEWAY READY] ${readyClient.user.tag}`
  );

  console.log(
    '[CHANNEL] XINCHEN-SG : 1536956205803503686'
  );

  console.log(
    '[CHANNEL] XINCHEN-IRL: 1555181833816117359'
  );

});


/******************************************************************
 * MESSAGE CREATE
 ******************************************************************/

client.on(Events.MessageCreate, async message => {

  try {

    // ============================================================
    // Ignore bot / webhook messages
    // ============================================================

    if (message.author.bot) {
      return;
    }

    if (message.webhookId) {
      return;
    }


    // ============================================================
    // Only SG / IRL receipt channels
    // ============================================================

    const company =
      CHANNELS[message.channel.id];

    if (!company) {
      return;
    }


    const content =
      String(message.content || '').trim();


    if (!content) {
      return;
    }


    console.log(
      `[MESSAGE] ${company} | ${message.author.tag} | ${content}`
    );


    // ============================================================
    // VOID COMMAND
    // ============================================================

    if (
      VOID_WORDS.has(
        content.toLowerCase()
      )
    ) {

      await handleVoid(
        message,
        company
      );

      return;
    }


    // ============================================================
    // PURE AMOUNT ONLY
    //
    // Accepted:
    // 168
    // 168.3
    // 168.38
    // 1,688
    // 1,688.38
    //
    // Rejected:
    // +168
    // RM168
    // 168 abc
    // 168.999
    // multi-line
    // ============================================================

    const amount =
      parseAmount(content);


    if (amount === null) {

      // 非金額聊天不回覆、不記錄
      return;

    }


    await handleReceipt(
      message,
      company,
      amount
    );


  } catch (err) {

    console.error(
      '[MESSAGE ERROR]',
      err
    );

  }

});


/******************************************************************
 * IMPORTANT:
 * 沒有 MessageUpdate listener
 *
 * 所以：
 * 原本 100
 * Edit -> 9999
 *
 * Google Sheet 仍然保持 100。
 *
 * 必須 VOID 後重新報數。
 ******************************************************************/


/******************************************************************
 * HANDLE RECEIPT
 ******************************************************************/

async function handleReceipt(
  message,
  company,
  amount
) {

  try {

    const reporter =
      getDisplayName(message);


    console.log(
      '[RECEIPT]',
      {
        company,
        amount,
        reporter,
        messageId: message.id
      }
    );


    // ============================================================
    // ADD TO GOOGLE SHEET
    // ============================================================

    const result =
      await callAppsScript({

        action: 'ADD',

        company,

        amount,

        reporter,

        discordId:
          message.author.id,

        messageId:
          message.id

      });


    console.log(
      '[ADD RESULT]',
      result
    );


    if (!result || !result.ok) {

      await safeReply(
        message,
        [
          '⚠️ **Receipt failed | 入款記錄失敗**',
          '',
          '系統暫時無法完成記錄，請稍後再試。',
          'The system could not record this receipt. Please try again later.'
        ].join('\n')
      );

      return;
    }


    // ============================================================
    // DUPLICATE
    // ============================================================

    if (result.duplicate) {

      console.log(
        `[DUPLICATE] ${message.id}`
      );

      return;
    }


    // ============================================================
    // GET UPDATED SUMMARY
    // ============================================================

    const summary =
      await getSummary(company);


    if (
      !summary ||
      !summary.ok
    ) {

      // ADD 已經成功。
      // Summary 失敗不能跟使用者說入款失敗。
      await safeReply(
        message,
        [
          `✅ **Receipt Confirmed | 已確認入款：RM ${formatMoney(amount)}**`,
          '',
          `👤 ${reporter}`,
          '',
          '⚠️ 今日統計暫時無法載入。',
          'Daily summary is temporarily unavailable.'
        ].join('\n')
      );

      return;
    }


    // ============================================================
    // SEND RECEIPT SUMMARY
    // ============================================================

    const embed =
      buildSummaryEmbed({
        company,
        amount,
        reporter,
        summary,
        titleType: 'ADD'
      });


    await message.reply({
      embeds: [embed],
      allowedMentions: {
        repliedUser: false
      }
    });


    console.log(
      `[RECEIPT SUCCESS] ${company} RM ${formatMoney(amount)}`
    );


  } catch (err) {

    console.error(
      '[HANDLE RECEIPT ERROR]',
      err
    );


    await safeReply(
      message,
      [
        '⚠️ **System Error | 系統錯誤**',
        '',
        '暫時無法處理這筆入款，請稍後再試。',
        'Unable to process this receipt right now.'
      ].join('\n')
    );

  }

}


/******************************************************************
 * HANDLE VOID
 ******************************************************************/

async function handleVoid(
  message,
  company
) {

  try {

    // ============================================================
    // Must reply to a message
    // ============================================================

    if (
      !message.reference ||
      !message.reference.messageId
    ) {

      await safeReply(
        message,
        [
          '⚠️ **Void failed | 撤銷失敗**',
          '',
          '請 Reply 要撤銷的原始金額訊息，再輸入 `void`。',
          'Please reply to the original amount message and send `void`.'
        ].join('\n')
      );

      return;
    }


    const targetMessageId =
      message.reference.messageId;


    let targetMessage = null;


    try {

      targetMessage =
        await message.channel.messages.fetch(
          targetMessageId
        );

    } catch (err) {

      console.log(
        '[VOID TARGET FETCH FAILED]',
        targetMessageId
      );

    }


    // ============================================================
    // 如果 Reply 到 Bot 的確認訊息
    //
    // Bot 確認訊息本身是 reply 原始入款，
    // 所以追溯到原始 message ID。
    // ============================================================

    let originalMessageId =
      targetMessageId;


    if (
      targetMessage &&
      targetMessage.author &&
      targetMessage.author.id ===
        client.user.id &&
      targetMessage.reference &&
      targetMessage.reference.messageId
    ) {

      originalMessageId =
        targetMessage.reference.messageId;

    }


    const voidedBy =
      getDisplayName(message);


    console.log(
      '[VOID]',
      {
        company,
        targetMessageId:
          originalMessageId,
        voidMessageId:
          message.id,
        voidedBy
      }
    );


    const result =
      await callAppsScript({

        action: 'VOID',

        company,

        targetMessageId:
          originalMessageId,

        voidMessageId:
          message.id,

        voidedBy

      });


    console.log(
      '[VOID RESULT]',
      result
    );


    // ============================================================
    // NOT FOUND
    // ============================================================

    if (
      !result ||
      !result.ok
    ) {

      let messageText =
        [
          '❌ **Void failed | 撤銷失敗**',
          '',
          '找不到這筆入款記錄。',
          'Receipt record not found.'
        ].join('\n');


      if (
        result &&
        result.error &&
        result.error !== 'NOT_FOUND'
      ) {

        messageText =
          [
            '⚠️ **Void failed | 撤銷失敗**',
            '',
            '系統暫時無法處理撤銷，請稍後再試。',
            'The system could not process this void request.'
          ].join('\n');

      }


      await safeReply(
        message,
        messageText
      );

      return;
    }


    // ============================================================
    // ALREADY VOIDED
    // ============================================================

    if (result.alreadyVoided) {

      await safeReply(
        message,
        [
          '⚠️ **Already Voided | 已經撤銷**',
          '',
          `Amount | 金額：**RM ${formatMoney(result.amount)}**`,
          '',
          '這筆入款之前已經撤銷，不能重複撤銷。',
          'This receipt has already been voided.'
        ].join('\n')
      );

      return;
    }


    // ============================================================
    // VOID SUCCESS → GET NEW SUMMARY
    // ============================================================

    const summary =
      await getSummary(company);


    if (
      !summary ||
      !summary.ok
    ) {

      await safeReply(
        message,
        [
          `♻️ **Voided Successfully | 已撤銷：RM ${formatMoney(result.amount)}**`,
          '',
          '撤銷已寫入，但今日統計暫時無法載入。',
          'Void recorded successfully, but the daily summary is temporarily unavailable.'
        ].join('\n')
      );

      return;
    }


    const embed =
      buildSummaryEmbed({

        company,

        amount:
          Number(result.amount || 0),

        reporter:
          result.reporter || '',

        summary,

        titleType: 'VOID'

      });


    await message.reply({
      embeds: [embed],
      allowedMentions: {
        repliedUser: false
      }
    });


    console.log(
      `[VOID SUCCESS] ${company} RM ${formatMoney(result.amount)}`
    );


  } catch (err) {

    console.error(
      '[HANDLE VOID ERROR]',
      err
    );


    await safeReply(
      message,
      [
        '⚠️ **System Error | 系統錯誤**',
        '',
        '暫時無法處理撤銷。',
        'Unable to process the void request right now.'
      ].join('\n')
    );

  }

}


/******************************************************************
 * BUILD SUMMARY EMBED
 ******************************************************************/

function buildSummaryEmbed({
  company,
  amount,
  reporter,
  summary,
  titleType
}) {

  const isVoid =
    titleType === 'VOID';


  const title =
    isVoid
      ? `♻️ 已撤銷入款：RM ${formatMoney(amount)} | Receipt Voided`
      : `✅ 已確認入款：RM ${formatMoney(amount)} | Receipt Confirmed`;


  const entries =
    Array.isArray(summary.entries)
      ? summary.entries
      : [];


  let visibleEntries =
    entries;


  let hiddenCount = 0;


  // Discord Embed 有長度限制。
  // 如果一天非常多筆，只顯示最新 25 筆。
  if (
    entries.length >
    MAX_SUMMARY_ENTRIES
  ) {

    hiddenCount =
      entries.length -
      MAX_SUMMARY_ENTRIES;


    visibleEntries =
      entries.slice(
        -MAX_SUMMARY_ENTRIES
      );

  }


  let receiptLines =
    visibleEntries.map(entry => {

      const time =
        String(
          entry.time || ''
        );


      const entryAmount =
        formatMoney(
          entry.amount
        );


      const entryReporter =
        String(
          entry.reporter || 'User'
        );


      return (
        `${time}  RM ${entryAmount}  (${entryReporter})`
      );

    });


  if (
    receiptLines.length === 0
  ) {

    receiptLines = [
      'No active receipts | 暫無有效入款'
    ];

  }


  if (hiddenCount > 0) {

    receiptLines.unshift(
      `… ${hiddenCount} earlier receipts not shown | 前面 ${hiddenCount} 筆未顯示`
    );

  }


  let description = '';


  if (isVoid) {

    description +=
      `**Voided By | 撤銷人：** ${reporter || '-'}\n\n`;

  } else {

    description +=
      `**Reporter | 報數人：** ${reporter || '-'}\n\n`;

  }


  description +=
    `💹 **Today's Receipts | 今日入款（${Number(summary.count || 0)}筆）**\n`;


  description +=
    receiptLines.join('\n');


  description +=
    `\n\n**Total | 總入款：RM ${formatMoney(summary.totalAmount)}**`;


  description +=
    `\n**Business Date | 工作日：${summary.businessDate || '-'}**`;


  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text:
        `${company} • XINCHEN RECEIPT`
    })
    .setTimestamp();

}


/******************************************************************
 * GET SUMMARY
 ******************************************************************/

async function getSummary(company) {

  return await callAppsScript({

    action: 'SUMMARY',
    company

  });

}


/******************************************************************
 * APPS SCRIPT REQUEST
 ******************************************************************/

async function callAppsScript(payload) {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => controller.abort(),
      25000
    );


  try {

    console.log(
      '[APPS REQUEST]',
      payload.action,
      payload.company
    );


    const response =
      await fetch(
        APPS_SCRIPT_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'text/plain;charset=utf-8'
          },

          body:
            JSON.stringify(payload),

          signal:
            controller.signal,

          redirect:
            'follow'
        }
      );


    const raw =
      await response.text();


    console.log(
      '[APPS HTTP STATUS]',
      response.status
    );


    console.log(
      '[APPS RAW RESPONSE]',
      raw.substring(0, 1500)
    );


    if (!response.ok) {

      throw new Error(
        `Apps Script HTTP ${response.status}`
      );

    }


    let result;


    try {

      result =
        JSON.parse(raw);

    } catch (err) {

      throw new Error(
        'Apps Script returned invalid JSON.'
      );

    }


    return result;


  } finally {

    clearTimeout(timeout);

  }

}


/******************************************************************
 * PARSE AMOUNT
 ******************************************************************/

function parseAmount(content) {

  if (
    typeof content !== 'string'
  ) {

    return null;

  }


  const text =
    content.trim();


  // 不允許換行
  if (
    text.includes('\n') ||
    text.includes('\r')
  ) {

    return null;

  }


  /*
   * Accepted:
   *
   * 100
   * 100.5
   * 100.50
   * 1,000
   * 1,000.50
   * 5555.55
   *
   * Rejected:
   *
   * +100
   * -100
   * RM100
   * 100 abc
   * 100.999
   * 1,00
   */

  const amountRegex =
    /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;


  if (
    !amountRegex.test(text)
  ) {

    return null;

  }


  const normalized =
    text.replace(/,/g, '');


  const amount =
    Number(normalized);


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {

    return null;

  }


  // 防止極端錯誤輸入
  if (
    amount >
    999999999.99
  ) {

    return null;

  }


  return (
    Math.round(
      amount * 100
    ) / 100
  );

}


/******************************************************************
 * DISPLAY NAME
 ******************************************************************/

function getDisplayName(message) {

  if (
    message.member &&
    message.member.displayName
  ) {

    return String(
      message.member.displayName
    );

  }


  if (
    message.author &&
    message.author.globalName
  ) {

    return String(
      message.author.globalName
    );

  }


  if (
    message.author &&
    message.author.username
  ) {

    return String(
      message.author.username
    );

  }


  return 'User';

}


/******************************************************************
 * SAFE REPLY
 ******************************************************************/

async function safeReply(
  message,
  content
) {

  try {

    await message.reply({
      content,
      allowedMentions: {
        repliedUser: false
      }
    });

  } catch (err) {

    console.error(
      '[REPLY ERROR]',
      err
    );

  }

}


/******************************************************************
 * PROCESS ERROR PROTECTION
 ******************************************************************/

process.on(
  'unhandledRejection',
  error => {

    console.error(
      '[UNHANDLED REJECTION]',
      error
    );

  }
);


process.on(
  'uncaughtException',
  error => {

    console.error(
      '[UNCAUGHT EXCEPTION]',
      error
    );

  }
);


/******************************************************************
 * LOGIN
 ******************************************************************/

client.login(TOKEN);
