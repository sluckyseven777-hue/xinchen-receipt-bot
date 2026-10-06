/******************************************************************
 * XINCHEN RECEIPT BOT V1.4 SAFE
 *
 * SG  : 1536956205803503686
 * IRL : 1555181833816117359
 *
 * SAFE ACCOUNTING DESIGN
 *
 * - Pure amount only
 * - SG / IRL separated
 * - No currency / exchange rate
 * - Business Date summary
 * - MessageID dedupe
 * - Void
 * - Edit ignored
 * - ADD summary returned directly
 * - Failed ADD response will be verified by MessageID
 * - Never blindly repeat ADD
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

const TOKEN =
  process.env.TOKEN;

const APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL;


if (!TOKEN) {

  console.error(
    '[BOOT ERROR] TOKEN is missing'
  );

  process.exit(1);

}


if (!APPS_SCRIPT_URL) {

  console.error(
    '[BOOT ERROR] APPS_SCRIPT_URL is missing'
  );

  process.exit(1);

}


/******************************************************************
 * CONFIG
 ******************************************************************/

const VERSION =
  'XINCHEN RECEIPT BOT V1.4 SAFE';


const CHANNELS = {

  '1536956205803503686':
    'XINCHEN-SG',

  '1555181833816117359':
    'XINCHEN-IRL'

};


const VOID_WORDS =
  new Set([

    'void',
    'cancel',
    '撤销',
    '撤銷'

  ]);


const MAX_SUMMARY_ENTRIES =
  25;


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
      '[CHANNEL] XINCHEN-SG : 1536956205803503686'
    );

    console.log(
      '[CHANNEL] XINCHEN-IRL: 1555181833816117359'
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
        parseAmount(
          content
        );


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
    getDisplayName(
      message
    );


  const payload = {

    action:
      'ADD',

    company,

    amount,

    reporter,

    discordId:
      message.author.id,

    messageId:
      message.id

  };


  let result = null;


  try {

    console.log(
      '[RECEIPT]',
      {
        company,
        amount,
        reporter,
        messageId:
          message.id
      }
    );


    /**************************************************************
     * PRIMARY ADD
     **************************************************************/

    try {

      result =
        await callAppsScript(
          payload
        );

    } catch (addError) {

      console.error(
        '[ADD RESPONSE ERROR]',
        addError.message
      );


      /************************************************************
       * IMPORTANT
       *
       * ADD may already have been written.
       *
       * NEVER blindly send ADD again.
       *
       * Verify MessageID first.
       ************************************************************/

      result =
        await verifyReceipt(
          company,
          message.id
        );


      if (
        result &&
        result.ok &&
        result.found
      ) {

        console.log(
          '[ADD RECOVERED BY CHECK]',
          message.id
        );


        result = {

          ok:
            true,

          duplicate:
            false,

          recovered:
            true,

          company:
            company,

          amount:
            Number(
              result.amount || amount
            ),

          status:
            result.status,

          summary:
            result.summary

        };

      } else {

        /**********************************************************
         * UNKNOWN STATE
         *
         * We do NOT tell user to repost.
         **********************************************************/

        await safeReply(
          message,
          [
            '⏳ **Receipt Pending Verification | 入款狀態確認中**',
            '',
            `Amount | 金額：**${formatAmount(amount)}**`,
            '',
            '系統暫時無法確認回傳結果。',
            '請勿重新報數，以免造成重複記錄。',
            '',
            'The system could not confirm the response.',
            'Please do NOT repost this amount.'
          ].join('\n')
        );

        return;

      }

    }


    console.log(
      '[ADD RESULT]',
      result
    );


    /**************************************************************
     * FAILED
     **************************************************************/

    if (
      !result ||
      !result.ok
    ) {

      await safeReply(
        message,
        [
          '⚠️ **Receipt Not Confirmed | 入款未確認**',
          '',
          `Amount | 金額：**${formatAmount(amount)}**`,
          '',
          '請勿重新報數。',
          'Please do NOT repost this amount.',
          '',
          '請通知管理員檢查記錄。'
        ].join('\n')
      );

      return;

    }


    /**************************************************************
     * DUPLICATE
     **************************************************************/

    if (
      result.duplicate
    ) {

      console.log(
        `[DUPLICATE] ${message.id}`
      );

      return;

    }


    /**************************************************************
     * SUMMARY
     **************************************************************/

    let summary =
      result.summary || null;


    /*
     * If ADD succeeded but for some reason summary
     * is not included, try one SUMMARY request.
     *
     * This does NOT affect accounting.
     */

    if (
      !summary ||
      !summary.ok
    ) {

      try {

        summary =
          await getSummary(
            company
          );

      } catch (summaryError) {

        console.error(
          '[SUMMARY FALLBACK ERROR]',
          summaryError.message
        );

      }

    }


    /**************************************************************
     * CONFIRMED WITHOUT SUMMARY
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
          '入款已成功記錄。',
          'Receipt has been recorded successfully.',
          '',
          '⚠️ 今日統計暫時無法顯示。'
        ].join('\n')
      );

      return;

    }


    /**************************************************************
     * EMBED
     **************************************************************/

    const embed =
      buildSummaryEmbed({

        company,

        amount,

        reporter,

        summary,

        titleType:
          'ADD'

      });


    await message.reply({

      embeds:
        [embed],

      allowedMentions: {
        repliedUser:
          false
      }

    });


    console.log(
      `[RECEIPT SUCCESS] ${company} ${formatAmount(amount)}`
    );


  } catch (error) {

    console.error(
      '[HANDLE RECEIPT ERROR]',
      error
    );


    /*
     * At this stage we cannot safely say
     * "failed".
     */

    await safeReply(
      message,
      [
        '⚠️ **Receipt Status Unknown | 入款狀態待確認**',
        '',
        `Amount | 金額：**${formatAmount(amount)}**`,
        '',
        '請勿重新報數。',
        'Please do NOT repost this amount.',
        '',
        '請通知管理員檢查 Sheet。'
      ].join('\n')
    );

  }

}


/******************************************************************
 * VERIFY RECEIPT
 ******************************************************************/

async function verifyReceipt(
  company,
  messageId
) {

  console.log(
    `[VERIFY RECEIPT] ${company} ${messageId}`
  );


  try {

    const result =
      await callAppsScript({

        action:
          'CHECK',

        company,

        messageId

      });


    console.log(
      '[VERIFY RESULT]',
      result
    );


    return result;


  } catch (error) {

    console.error(
      '[VERIFY ERROR]',
      error.message
    );


    return null;

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


    let result =
      null;


    try {

      result =
        await callAppsScript({

          action:
            'VOID',

          company,

          targetMessageId:
            originalMessageId,

          voidMessageId:
            message.id,

          voidedBy

        });


    } catch (error) {

      /*
       * VOID may have succeeded even if Google response failed.
       *
       * CHECK original MessageID.
       */

      console.error(
        '[VOID RESPONSE ERROR]',
        error.message
      );


      const check =
        await verifyReceipt(
          company,
          originalMessageId
        );


      if (
        check &&
        check.ok &&
        check.found &&
        check.status === 'Voided'
      ) {

        result = {

          ok:
            true,

          voided:
            true,

          recovered:
            true,

          company,

          amount:
            check.amount,

          summary:
            check.summary

        };


        console.log(
          '[VOID RECOVERED BY CHECK]',
          originalMessageId
        );


      } else {

        await safeReply(
          message,
          [
            '⏳ **Void Pending Verification | 撤銷狀態待確認**',
            '',
            '系統暫時無法確認撤銷結果。',
            '請勿重複撤銷。',
            '',
            'The system could not confirm the void result.',
            'Please do NOT repeat the void request.'
          ].join('\n')
        );

        return;

      }

    }


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
            '⚠️ **Void Not Confirmed | 撤銷未確認**',
            '',
            '請勿重複撤銷。',
            'Please do NOT repeat the void request.'
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
          '這筆入款之前已經撤銷，不能重複撤銷。',
          'This receipt has already been voided.'
        ].join('\n')
      );

      return;

    }


    let summary =
      result.summary || null;


    if (
      !summary ||
      !summary.ok
    ) {

      try {

        summary =
          await getSummary(
            company
          );

      } catch (error) {

        console.error(
          '[SUMMARY ERROR AFTER VOID]',
          error.message
        );

      }

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

        titleType:
          'VOID'

      });


    await message.reply({

      embeds:
        [embed],

      allowedMentions: {
        repliedUser:
          false
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
        '⚠️ **Void Status Unknown | 撤銷狀態待確認**',
        '',
        '請勿重複撤銷。',
        'Please do NOT repeat the void request.',
        '',
        '請通知管理員檢查 Sheet。'
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
    titleType ===
      'VOID';


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
          `${time}  ${entryAmount}  (${entryReporter})`
        );

      }
    );


  if (
    receiptLines.length ===
    0
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


  let description =
    '';


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
    receiptLines.join(
      '\n'
    );


  description +=
    `\n\n**Total | 總入款：${formatAmount(summary.totalAmount)}**`;


  description +=
    `\n**Business Date | 工作日：${summary.businessDate || '-'}**`;


  return new EmbedBuilder()

    .setTitle(
      title
    )

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
 * GET SUMMARY
 ******************************************************************/

async function getSummary(
  company
) {

  return await callAppsScript({

    action:
      'SUMMARY',

    company

  });

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
      !appsUrl.endsWith(
        '/exec'
      )
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

          method:
            'POST',

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

          redirect:
            'follow',

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


    if (
      !response.ok
    ) {

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
      typeof result !==
        'object'
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

    clearTimeout(
      timeout
    );

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
    !amountRegex.test(
      text
    )
  ) {

    return null;

  }


  const normalized =
    text.replace(
      /,/g,
      ''
    );


  const amount =
    Number(
      normalized
    );


  if (
    !Number.isFinite(
      amount
    ) ||
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
    !Number.isFinite(
      amount
    )
  ) {

    return '0.00';

  }


  return amount.toLocaleString(
    'en-US',
    {

      minimumFractionDigits:
        2,

      maximumFractionDigits:
        2

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
        repliedUser:
          false
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

client.login(
  TOKEN
);
