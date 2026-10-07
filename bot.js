/******************************************************************
 * XINCHEN RECEIPT BOT V1.3 STABLE VERIFY
 *
 * IMPORTANT:
 * - Apps Script 不需要修改
 * - ADD 永远只发送一次
 * - ADD timeout / 404 后绝对不会重新 ADD
 * - 使用 SUMMARY + MessageID 确认是否已经成功入账
 * - SUMMARY 自动重试
 * - SG / IRL 完全独立
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

const VERSION =
  'XINCHEN RECEIPT BOT V1.3 STABLE VERIFY';

const CHANNELS = {
  '1536956205803503686': 'XINCHEN-SG',
  '1555181833816117359': 'XINCHEN-IRL'
};

const VOID_WORDS =
  new Set([
    'void',
    'cancel',
    '撤销',
    '撤銷'
  ]);

const MAX_SUMMARY_ENTRIES = 25;


/******************************************************************
 * DISCORD
 ******************************************************************/

const client =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });


/******************************************************************
 * HTTP SERVER
 ******************************************************************/

const PORT =
  process.env.PORT || 10000;

const server =
  http.createServer(
    (req, res) => {

      res.writeHead(
        200,
        {
          'Content-Type':
            'text/plain; charset=utf-8'
        }
      );

      res.end(
        `XINCHEN Receipt Bot is running.\n${VERSION}`
      );

    }
  );

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `[HTTP] listening: ${PORT}`
    );
  }
);


/******************************************************************
 * READY
 ******************************************************************/

client.once(
  Events.ClientReady,
  readyClient => {

    console.log(
      `[BOOT] ${VERSION}`
    );

    console.log(
      `[GATEWAY READY] ${readyClient.user.tag}`
    );

    console.log(
      '[CHANNEL] XINCHEN-SG  : 1536956205803503686'
    );

    console.log(
      '[CHANNEL] XINCHEN-IRL : 1555181833816117359'
    );

  }
);


/******************************************************************
 * MESSAGE CREATE
 ******************************************************************/

client.on(
  Events.MessageCreate,
  async message => {

    try {

      if (message.author.bot) {
        return;
      }

      if (message.webhookId) {
        return;
      }

      const company =
        CHANNELS[
          message.channel.id
        ];

      if (!company) {
        return;
      }

      const content =
        String(
          message.content || ''
        ).trim();

      if (!content) {
        return;
      }

      console.log(
        `[MESSAGE] ${company} | ${message.author.tag} | ${content}`
      );


      /************************************************************
       * VOID
       ************************************************************/

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


      /************************************************************
       * AMOUNT
       ************************************************************/

      const amount =
        parseAmount(content);

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

  }
);


/******************************************************************
 * HANDLE RECEIPT
 ******************************************************************/

async function handleReceipt(
  message,
  company,
  amount
) {

  const reporter =
    getDisplayName(message);

  const messageId =
    message.id;

  console.log(
    '[RECEIPT]',
    {
      company,
      amount,
      reporter,
      messageId
    }
  );


  /****************************************************************
   * STEP 1
   * ADD 只发送一次
   ****************************************************************/

  let addResult = null;
  let addResponseFailed = false;

  try {

    addResult =
      await callAppsScript({

        action: 'ADD',

        company,

        amount,

        reporter,

        discordId:
          message.author.id,

        messageId

      });

    console.log(
      '[ADD RESULT]',
      addResult
    );

  } catch (error) {

    /*
     * 非常重要：
     *
     * 这里只代表 HTTP response 失败。
     * 不代表 Sheet 没写入。
     *
     * 绝对不重新 ADD。
     */

    addResponseFailed = true;

    console.error(
      '[ADD RESPONSE FAILED]',
      company,
      messageId,
      error.message
    );

  }


  /****************************************************************
   * STEP 2
   * ADD 正常明确失败
   ****************************************************************/

  if (
    !addResponseFailed &&
    (
      !addResult ||
      !addResult.ok
    )
  ) {

    await safeReply(
      message,
      [
        '⚠️ **Receipt Failed | 入款記錄失敗**',
        '',
        '系統明確回傳入款失敗。',
        'The system returned an unsuccessful receipt result.',
        '',
        '請管理員檢查記錄。'
      ].join('\n')
    );

    return;
  }


  /****************************************************************
   * STEP 3
   * DUPLICATE
   ****************************************************************/

  if (
    !addResponseFailed &&
    addResult &&
    addResult.duplicate
  ) {

    console.log(
      `[DUPLICATE] ${messageId}`
    );

    return;
  }


  /****************************************************************
   * STEP 4
   * 查 SUMMARY
   *
   * 无论 ADD 正常还是 response timeout，
   * 都通过 SUMMARY 得到最新 Total。
   ****************************************************************/

  const summary =
    await getSummaryWithRetry(
      company,
      3
    );


  /****************************************************************
   * CASE A
   * ADD response 正常成功
   ****************************************************************/

  if (
    !addResponseFailed &&
    addResult &&
    addResult.ok
  ) {

    if (
      summary &&
      summary.ok
    ) {

      await sendReceiptConfirmation(
        message,
        company,
        amount,
        reporter,
        summary
      );

      console.log(
        `[RECEIPT SUCCESS] ${company} ${formatAmount(amount)}`
      );

      return;
    }


    /*
     * ADD 已明确成功。
     * Summary 即使失败也不能显示 System Error。
     */

    await safeReply(
      message,
      [
        `✅ **Receipt Confirmed | 已確認入款：${formatAmount(amount)}**`,
        '',
        `👤 **Reporter | 報數人：** ${reporter}`,
        '',
        '入款已成功記錄。',
        'Receipt has been recorded successfully.',
        '',
        '⚠️ 今日統計暫時無法載入。'
      ].join('\n')
    );

    return;
  }


  /****************************************************************
   * CASE B
   * ADD response timeout / 404
   *
   * 用 SUMMARY 里的 MessageID 验证。
   ****************************************************************/

  if (
    addResponseFailed
  ) {

    if (
      summary &&
      summary.ok
    ) {

      const found =
        findMessageInSummary(
          summary,
          messageId
        );


      /************************************************************
       * 找到了！
       *
       * 证明刚才 ADD 虽然 HTTP response 失败，
       * 但 Sheet 实际已经成功写入。
       ************************************************************/

      if (found) {

        console.log(
          '[ADD VERIFIED BY SUMMARY]',
          {
            company,
            messageId,
            amount: found.amount
          }
        );


        await sendReceiptConfirmation(
          message,
          company,
          Number(
            found.amount || amount
          ),
          reporter,
          summary
        );


        console.log(
          `[RECEIPT RECOVERED] ${company} ${messageId}`
        );

        return;
      }


      /************************************************************
       * SUMMARY 成功，但找不到这个 MessageID
       *
       * 这时候不能重新 ADD。
       ************************************************************/

      console.error(
        '[ADD NOT FOUND IN SUMMARY]',
        company,
        messageId
      );


      await safeReply(
        message,
        [
          '⚠️ **Receipt Not Confirmed | 入款未確認**',
          '',
          `Amount | 金額：**${formatAmount(amount)}**`,
          '',
          '系統沒有在今日記錄中找到這筆 Message ID。',
          'The receipt was not found in today\'s records.',
          '',
          '請先讓管理員檢查 Sheet，**不要立即重新報數**。'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * ADD response 失败
     * SUMMARY 也完全查不到
     *
     * 状态未知。
     **************************************************************/

    await safeReply(
      message,
      [
        '⏳ **Receipt Pending Verification | 入款狀態待確認**',
        '',
        `Amount | 金額：**${formatAmount(amount)}**`,
        '',
        'Google 暫時沒有回傳可確認的結果。',
        '',
        '**請勿重新報數。**',
        'Please do NOT repost this amount.',
        '',
        '請管理員直接檢查 Sheet。'
      ].join('\n')
    );

    return;
  }

}


/******************************************************************
 * FIND MESSAGE IN SUMMARY
 ******************************************************************/

function findMessageInSummary(
  summary,
  messageId
) {

  if (
    !summary ||
    !Array.isArray(
      summary.entries
    )
  ) {

    return null;
  }


  const target =
    String(
      messageId
    ).trim();


  for (
    const entry of
    summary.entries
  ) {

    const id =
      String(
        entry.messageId || ''
      ).trim();


    if (
      id === target
    ) {

      return entry;
    }

  }


  return null;
}


/******************************************************************
 * SEND RECEIPT CONFIRMATION
 ******************************************************************/

async function sendReceiptConfirmation(
  message,
  company,
  amount,
  reporter,
  summary
) {

  try {

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

  } catch (error) {

    console.error(
      '[CONFIRMATION EMBED ERROR]',
      error
    );


    /*
     * 入账已经确认。
     * Discord Embed 出错也不能显示 System Error。
     */

    await safeReply(
      message,
      [
        `✅ **Receipt Confirmed | 已確認入款：${formatAmount(amount)}**`,
        '',
        `👤 **Reporter | 報數人：** ${reporter}`,
        '',
        `💹 **Today's Total | 今日總入款：${formatAmount(summary.totalAmount)}**`,
        '',
        `📅 **Business Date | 工作日：${summary.businessDate || '-'}**`
      ].join('\n')
    );

  }

}


/******************************************************************
 * SUMMARY WITH RETRY
 *
 * 这里只 READ。
 * 不会 ADD。
 ******************************************************************/

async function getSummaryWithRetry(
  company,
  maxAttempts = 3
) {

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {

    try {

      console.log(
        `[SUMMARY ATTEMPT] ${company} ${attempt}/${maxAttempts}`
      );


      const result =
        await callAppsScript({

          action: 'SUMMARY',

          company

        });


      if (
        result &&
        result.ok
      ) {

        console.log(
          `[SUMMARY SUCCESS] ${company} ${attempt}/${maxAttempts}`
        );

        return result;
      }


      console.error(
        `[SUMMARY INVALID] ${company} ${attempt}/${maxAttempts}`,
        result
      );


    } catch (error) {

      console.error(
        `[SUMMARY FAILED] ${company} ${attempt}/${maxAttempts}`,
        error.message
      );

    }


    if (
      attempt <
      maxAttempts
    ) {

      /*
       * 1st retry: 1 second
       * 2nd retry: 2 seconds
       */

      const waitMs =
        attempt * 1000;


      console.log(
        `[SUMMARY RETRY] ${company} in ${waitMs}ms`
      );


      await sleep(
        waitMs
      );

    }

  }


  console.error(
    `[SUMMARY GIVE UP] ${company}`
  );


  return null;
}


/******************************************************************
 * VOID
 ******************************************************************/

async function handleVoid(
  message,
  company
) {

  try {

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


    let targetMessage =
      null;


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


    let originalMessageId =
      targetMessageId;


    /*
     * 如果 reply 的是 Bot confirmation，
     * 追溯到原始报数 MessageID。
     */

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
      getDisplayName(
        message
      );


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


    if (
      !result ||
      !result.ok
    ) {

      if (
        result &&
        result.error ===
          'NOT_FOUND'
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
            '系統暫時無法處理撤銷。',
            'The system could not process this void request.'
          ].join('\n')
        );

      }

      return;
    }


    if (
      result.alreadyVoided
    ) {

      await safeReply(
        message,
        [
          '⚠️ **Already Voided | 已經撤銷**',
          '',
          `Amount | 金額：**${formatAmount(result.amount)}**`,
          '',
          '這筆入款之前已經撤銷。',
          'This receipt has already been voided.'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * VOID 成功以后只查 SUMMARY
     **************************************************************/

    const summary =
      await getSummaryWithRetry(
        company,
        3
      );


    if (
      !summary ||
      !summary.ok
    ) {

      await safeReply(
        message,
        [
          `♻️ **Voided Successfully | 已撤銷：${formatAmount(result.amount)}**`,
          '',
          '撤銷已成功記錄。',
          'Void recorded successfully.',
          '',
          '⚠️ 今日統計暫時無法顯示。'
        ].join('\n')
      );

      return;
    }


    const embed =
      buildSummaryEmbed({

        company,

        amount:
          Number(
            result.amount || 0
          ),

        reporter:
          voidedBy,

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
      `[VOID SUCCESS] ${company} ${formatAmount(result.amount)}`
    );


  } catch (error) {

    console.error(
      '[HANDLE VOID ERROR]',
      error
    );


    /*
     * VOID HTTP response 异常时，
     * 不叫员工重复 void。
     */

    await safeReply(
      message,
      [
        '⏳ **Void Pending Verification | 撤銷狀態待確認**',
        '',
        '目前無法確認 Google 回傳結果。',
        '',
        '**請勿重複撤銷。**',
        'Please do NOT repeat the void request.',
        '',
        '請管理員檢查 Sheet 的 Status。'
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

      ? `♻️ 已撤銷入款：${formatAmount(amount)} | Receipt Voided`

      : `✅ 已確認入款：${formatAmount(amount)} | Receipt Confirmed`;


  const entries =
    Array.isArray(
      summary.entries
    )
      ? summary.entries
      : [];


  let visibleEntries =
    entries;


  let hiddenCount = 0;


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
    visibleEntries.map(
      entry => {

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
            entry.reporter ||
            'User'
          );


        return (
          `${time} ${entryAmount} (${entryReporter})`
        );

      }
    );


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

    .setDescription(
      description
    )

    .setFooter({
      text:
        `${company} • XINCHEN RECEIPT`
    })

    .setTimestamp();

}


/******************************************************************
 * APPS SCRIPT REQUEST
 ******************************************************************/

async function callAppsScript(
  payload
) {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      30000
    );


  try {

    const appsUrl =
      String(
        APPS_SCRIPT_URL || ''
      ).trim();


    if (!appsUrl) {

      throw new Error(
        'APPS_SCRIPT_URL is empty'
      );

    }


    if (
      !appsUrl.startsWith(
        'https://script.google.com/macros/s/'
      ) ||
      !appsUrl.endsWith('/exec')
    ) {

      throw new Error(
        'APPS_SCRIPT_URL must be a Google Apps Script /exec URL'
      );

    }


    console.log(
      `[APPS REQUEST] ${payload.action} ${payload.company || ''}`
    );


    const response =
      await fetch(
        appsUrl,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'text/plain;charset=utf-8',

            'Accept':
              'application/json,text/plain,*/*'
          },

          body:
            JSON.stringify(
              payload
            ),

          redirect: 'follow',

          signal:
            controller.signal
        }
      );


    const raw =
      await response.text();


    console.log(
      '[APPS HTTP STATUS]',
      response.status
    );


    console.log(
      '[APPS FINAL URL]',
      response.url
    );


    console.log(
      '[APPS CONTENT TYPE]',
      response.headers.get(
        'content-type'
      ) || ''
    );


    console.log(
      '[APPS RAW RESPONSE]',
      raw.substring(
        0,
        1500
      )
    );


    if (!response.ok) {

      throw new Error(
        `Apps Script HTTP ${response.status}`
      );

    }


    const trimmed =
      raw.trim();


    if (
      trimmed.startsWith(
        '<!DOCTYPE'
      ) ||
      trimmed.startsWith(
        '<html'
      ) ||
      trimmed.startsWith(
        '<HTML'
      )
    ) {

      throw new Error(
        'Apps Script returned HTML instead of JSON'
      );

    }


    let result;


    try {

      result =
        JSON.parse(
          trimmed
        );

    } catch (error) {

      throw new Error(
        'Apps Script returned invalid JSON'
      );

    }


    if (
      !result ||
      typeof result !== 'object'
    ) {

      throw new Error(
        'Apps Script returned invalid response object'
      );

    }


    return result;


  } catch (error) {

    if (
      error.name ===
      'AbortError'
    ) {

      console.error(
        '[APPS TIMEOUT]',
        payload.action,
        payload.company || ''
      );


      throw new Error(
        'Apps Script request timed out'
      );

    }


    console.error(
      '[APPS REQUEST ERROR]',
      payload.action,
      payload.company || '',
      error.message
    );


    throw error;


  } finally {

    clearTimeout(timeout);

  }

}


/******************************************************************
 * PARSE AMOUNT
 ******************************************************************/

function parseAmount(
  content
) {

  if (
    typeof content !==
    'string'
  ) {

    return null;
  }


  const text =
    content.trim();


  if (
    text.includes('\n') ||
    text.includes('\r')
  ) {

    return null;
  }


  const amountRegex =
    /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;


  if (
    !amountRegex.test(text)
  ) {

    return null;
  }


  const normalized =
    text.replace(
      /,/g,
      ''
    );


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
 ******************************************************************/

function formatAmount(
  value
) {

  const amount =
    Number(
      value || 0
    );


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

function getDisplayName(
  message
) {

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
 * SLEEP
 ******************************************************************/

function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );

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
