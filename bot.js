/******************************************************************
 * XINCHEN RECEIPT BOT V1.1 STABLE
 * 鑫財團簡易加賬機器人
 *
 * SG  : 1536956205803503686
 * IRL : 1555181833816117359
 *
 * - Pure amount only
 * - SG / IRL separated
 * - No currency / no exchange rate
 * - Daily business-date summary
 * - Reply + void / cancel / 撤销 / 撤銷
 * - Message edits ignored
 * - Apps Script MessageID dedupe
 * - Chinese / English
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
 * ENV
 ******************************************************************/

const TOKEN = process.env.TOKEN;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!TOKEN) {
  console.error('[BOOT ERROR] TOKEN is missing');
  process.exit(1);
}

if (!APPS_SCRIPT_URL) {
  console.error('[BOOT ERROR] APPS_SCRIPT_URL is missing');
  process.exit(1);
}


/******************************************************************
 * CONFIG
 ******************************************************************/

const VERSION = 'XINCHEN RECEIPT BOT V1.1 STABLE';

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
  console.log(`[HTTP] listening: ${PORT}`);
});


/******************************************************************
 * READY
 ******************************************************************/

client.once(Events.ClientReady, readyClient => {

  console.log(`[BOOT] ${VERSION}`);
  console.log(`[GATEWAY READY] ${readyClient.user.tag}`);

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

    // Ignore bots
    if (message.author.bot) {
      return;
    }

    // Ignore webhooks
    if (message.webhookId) {
      return;
    }

    // Only receipt channels
    const company = CHANNELS[message.channel.id];

    if (!company) {
      return;
    }

    const content = String(
      message.content || ''
    ).trim();

    if (!content) {
      return;
    }

    console.log(
      `[MESSAGE] ${company} | ${message.author.tag} | ${content}`
    );


    /**************************************************************
     * VOID
     **************************************************************/

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


    /**************************************************************
     * PURE AMOUNT
     **************************************************************/

    const amount = parseAmount(content);

    // 普通聊天直接忽略
    if (amount === null) {
      return;
    }

    await handleReceipt(
      message,
      company,
      amount
    );

  } catch (error) {

    console.error(
      '[MESSAGE ERROR]',
      error
    );

  }

});


/******************************************************************
 * IMPORTANT
 *
 * 沒有 MessageUpdate listener。
 *
 * 100
 * Edit -> 9999
 *
 * 不會重新入帳。
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

  const reporter = getDisplayName(message);

  let addResult = null;

  try {

    console.log(
      '[RECEIPT]',
      {
        company,
        amount,
        reporter,
        messageId: message.id
      }
    );


    /**************************************************************
     * ADD
     **************************************************************/

    addResult = await callAppsScript({

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
      addResult
    );


    /**************************************************************
     * ADD FAILED
     **************************************************************/

    if (
      !addResult ||
      !addResult.ok
    ) {

      await safeReply(
        message,
        [
          '⚠️ **Receipt Failed | 入款記錄失敗**',
          '',
          '系統暫時無法完成記錄，請稍後再試。',
          'The system could not record this receipt. Please try again later.'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * DUPLICATE
     **************************************************************/

    if (addResult.duplicate) {

      console.log(
        `[DUPLICATE] ${message.id}`
      );

      return;
    }


    /**************************************************************
     * ADD IS NOW CONFIRMED
     *
     * 從這裡開始，就算 Summary 壞掉，
     * 都不能再告訴使用者「入款失敗」。
     **************************************************************/

    let summary = null;

    try {

      summary = await getSummary(company);

    } catch (summaryError) {

      console.error(
        '[SUMMARY ERROR AFTER ADD]',
        summaryError
      );

    }


    /**************************************************************
     * SUMMARY UNAVAILABLE
     **************************************************************/

    if (
      !summary ||
      !summary.ok
    ) {

      await safeReply(
        message,
        [
          `✅ **Receipt Confirmed | 已確認入款：${formatAmount(amount)}**`,
          '',
          `👤 **Reporter | 報數人：** ${reporter}`,
          '',
          '⚠️ 今日統計暫時無法載入。',
          'Daily summary is temporarily unavailable.'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * BUILD EMBED
     **************************************************************/

    let embed;

    try {

      embed = buildSummaryEmbed({
        company,
        amount,
        reporter,
        summary,
        titleType: 'ADD'
      });

    } catch (embedError) {

      console.error(
        '[EMBED BUILD ERROR]',
        embedError
      );

      await safeReply(
        message,
        [
          `✅ **Receipt Confirmed | 已確認入款：${formatAmount(amount)}**`,
          '',
          `👤 **Reporter | 報數人：** ${reporter}`,
          '',
          `💹 **Today's Total | 今日總入款：${formatAmount(summary.totalAmount)}**`
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * SEND
     **************************************************************/

    try {

      await message.reply({
        embeds: [embed],
        allowedMentions: {
          repliedUser: false
        }
      });

    } catch (replyError) {

      console.error(
        '[EMBED REPLY ERROR]',
        replyError
      );

      // 入款已經成功，所以只做 fallback 顯示
      await safeReply(
        message,
        [
          `✅ **Receipt Confirmed | 已確認入款：${formatAmount(amount)}**`,
          '',
          `💹 **Today's Total | 今日總入款：${formatAmount(summary.totalAmount)}**`
        ].join('\n')
      );

    }


    console.log(
      `[RECEIPT SUCCESS] ${company} ${formatAmount(amount)}`
    );

  } catch (error) {

    console.error(
      '[HANDLE RECEIPT ERROR]',
      error
    );

    // 如果 ADD 已經確認成功，
    // 絕對不要說「入款失敗」
    if (
      addResult &&
      addResult.ok &&
      !addResult.duplicate
    ) {

      await safeReply(
        message,
        [
          `✅ **Receipt Confirmed | 已確認入款：${formatAmount(amount)}**`,
          '',
          '入款已經成功寫入，但顯示統計時發生錯誤。',
          'Receipt was recorded successfully, but the summary could not be displayed.'
        ].join('\n')
      );

      return;
    }

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

    /**************************************************************
     * MUST REPLY
     **************************************************************/

    if (
      !message.reference ||
      !message.reference.messageId
    ) {

      await safeReply(
        message,
        [
          '⚠️ **Void Failed | 撤銷失敗**',
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


    /**************************************************************
     * FETCH TARGET
     **************************************************************/

    try {

      targetMessage =
        await message.channel.messages.fetch(
          targetMessageId
        );

    } catch (error) {

      console.log(
        '[VOID TARGET FETCH FAILED]',
        targetMessageId
      );

    }


    /**************************************************************
     * BOT CONFIRMATION -> ORIGINAL MESSAGE
     **************************************************************/

    let originalMessageId =
      targetMessageId;

    if (
      targetMessage &&
      targetMessage.author &&
      targetMessage.author.id === client.user.id &&
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


    /**************************************************************
     * VOID REQUEST
     **************************************************************/

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


    /**************************************************************
     * FAILED
     **************************************************************/

    if (
      !result ||
      !result.ok
    ) {

      if (
        result &&
        result.error === 'NOT_FOUND'
      ) {

        await safeReply(
          message,
          [
            '❌ **Void Failed | 撤銷失敗**',
            '',
            '找不到這筆入款記錄。',
            'Receipt record not found.'
          ].join('\n')
        );

      } else {

        await safeReply(
          message,
          [
            '⚠️ **Void Failed | 撤銷失敗**',
            '',
            '系統暫時無法處理撤銷，請稍後再試。',
            'The system could not process this void request.'
          ].join('\n')
        );

      }

      return;
    }


    /**************************************************************
     * ALREADY VOIDED
     **************************************************************/

    if (result.alreadyVoided) {

      await safeReply(
        message,
        [
          '⚠️ **Already Voided | 已經撤銷**',
          '',
          `Amount | 金額：**${formatAmount(result.amount)}**`,
          '',
          '這筆入款之前已經撤銷，不能重複撤銷。',
          'This receipt has already been voided.'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * GET UPDATED SUMMARY
     **************************************************************/

    let summary = null;

    try {

      summary =
        await getSummary(company);

    } catch (summaryError) {

      console.error(
        '[SUMMARY ERROR AFTER VOID]',
        summaryError
      );

    }


    if (
      !summary ||
      !summary.ok
    ) {

      await safeReply(
        message,
        [
          `♻️ **Voided Successfully | 已撤銷：${formatAmount(result.amount)}**`,
          '',
          '撤銷已寫入，但今日統計暫時無法載入。',
          'Void recorded successfully, but the daily summary is temporarily unavailable.'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * BUILD VOID EMBED
     **************************************************************/

    let embed;

    try {

      embed = buildSummaryEmbed({

        company,

        amount:
          Number(result.amount || 0),

        reporter:
          voidedBy,

        summary,

        titleType:
          'VOID'

      });

    } catch (embedError) {

      console.error(
        '[VOID EMBED BUILD ERROR]',
        embedError
      );

      await safeReply(
        message,
        [
          `♻️ **Voided Successfully | 已撤銷：${formatAmount(result.amount)}**`,
          '',
          `💹 **Today's Total | 今日總入款：${formatAmount(summary.totalAmount)}**`
        ].join('\n')
      );

      return;
    }


    await message.reply({
      embeds: [embed],
      allowedMentions: {
        repliedUser: false
      }
    });


    console.log(
      `[VOID SUCCESS] ${company} ${formatAmount(result.amount)}`
    );

  } catch (error) {

    console.error(
      '[HANDLE VOID ERROR]',
      error
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


  /**************************************************************
   * TITLE
   **************************************************************/

  const title =
    isVoid
      ? `♻️ 已撤銷入款：${formatAmount(amount)} | Receipt Voided`
      : `✅ 已確認入款：${formatAmount(amount)} | Receipt Confirmed`;


  /**************************************************************
   * ENTRIES
   **************************************************************/

  const entries =
    Array.isArray(summary.entries)
      ? summary.entries
      : [];


  let visibleEntries =
    entries;

  let hiddenCount =
    0;


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


  /**************************************************************
   * RECEIPT LINES
   **************************************************************/

  let receiptLines =
    visibleEntries.map(entry => {

      const time =
        String(
          entry.time || ''
        );

      const entryAmount =
        formatAmount(
          entry.amount
        );

      const entryReporter =
        String(
          entry.reporter || 'User'
        );

      return (
        `${time}  ${entryAmount}  (${entryReporter})`
      );

    });


  if (
    receiptLines.length === 0
  ) {

    receiptLines = [
      'No active receipts | 暫無有效入款'
    ];

  }


  if (
    hiddenCount > 0
  ) {

    receiptLines.unshift(
      `… ${hiddenCount} earlier receipts not shown | 前面 ${hiddenCount} 筆未顯示`
    );

  }


  /**************************************************************
   * DESCRIPTION
   **************************************************************/

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
    `\n\n**Total | 總入款：${formatAmount(summary.totalAmount)}**`;


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
 * APPS SCRIPT
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

    } catch (error) {

      throw new Error(
        'Apps Script returned invalid JSON'
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


  // No multiline
  if (
    text.includes('\n') ||
    text.includes('\r')
  ) {
    return null;
  }


  /**************************************************************
   * ACCEPT
   *
   * 100
   * 100.5
   * 100.50
   * 1,000
   * 1,000.50
   * 168.38
   *
   * REJECT
   *
   * +100
   * -100
   * RM100
   * USD100
   * 100 abc
   * 100.999
   **************************************************************/

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
 * FORMAT AMOUNT
 *
 * IMPORTANT:
 * 這只是數字格式。
 *
 * 沒有 RM
 * 沒有 SGD
 * 沒有 USD
 * 沒有匯率
 * 沒有換算
 ******************************************************************/

function formatAmount(value) {

  const amount =
    Number(value || 0);


  if (
    !Number.isFinite(amount)
  ) {
    return '0.00';
  }


  return amount.toLocaleString(
    'en-US',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
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

  } catch (error) {

    console.error(
      '[SAFE REPLY ERROR]',
      error
    );

  }

}


/******************************************************************
 * PROCESS PROTECTION
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
