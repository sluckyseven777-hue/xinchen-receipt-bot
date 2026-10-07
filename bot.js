/******************************************************************
 * XINCHEN RECEIPT BOT V2.0 STABLE
 *
 * INPUT:
 * +11.23
 *
 * CORE:
 * - ADD only ONCE
 * - ADD success -> use returned summary
 * - ADD timeout / 404 / wrong response -> CHECK MessageID
 * - CHECK is READ ONLY
 * - NEVER retry ADD automatically
 * - Strict response validation
 * - VOID supported
 * - SG / IRL completely separate
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
  'XINCHEN RECEIPT BOT V2.0 STABLE';

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

const CHECK_ATTEMPTS = 3;


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
    String(message.id);

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
   *
   * ADD EXACTLY ONCE.
   *
   * Never retry this request automatically.
   ****************************************************************/

  let addResult = null;

  let addConfirmed = false;

  let needsCheck = false;


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


    /**************************************************************
     * STRICT ADD RESPONSE VALIDATION
     *
     * A random:
     *
     * {
     *   ok: true,
     *   system: "XINCHEN_RECEIPT"
     * }
     *
     * is NOT accepted as an ADD success.
     **************************************************************/

    if (
      isValidAddResult(
        addResult,
        company,
        messageId
      )
    ) {

      addConfirmed = true;

    } else {

      console.error(
        '[ADD RESPONSE INVALID / AMBIGUOUS]',
        {
          company,
          messageId,
          addResult
        }
      );

      needsCheck = true;

    }


  } catch (error) {

    /*
     * HTTP failure does NOT mean ADD failed.
     *
     * Sheet may already contain the receipt.
     *
     * NEVER ADD again.
     */

    console.error(
      '[ADD RESPONSE FAILED]',
      company,
      messageId,
      error.message
    );

    needsCheck = true;

  }


  /****************************************************************
   * STEP 2
   * NORMAL CONFIRMED ADD
   ****************************************************************/

  if (addConfirmed) {

    /**************************************************************
     * DUPLICATE SAME MESSAGE ID
     **************************************************************/

    if (
      addResult.duplicate === true
    ) {

      console.log(
        `[DUPLICATE MESSAGE ID] ${messageId}`
      );

      /*
       * Same Discord message already exists.
       * Do not create another confirmation message.
       */

      return;
    }


    const summary =
      normalizeSummary(
        addResult.summary,
        company
      );


    if (summary) {

      await sendReceiptConfirmation(
        message,
        company,
        Number(
          addResult.amount
        ),
        reporter,
        summary
      );

      console.log(
        `[RECEIPT SUCCESS] ${company} ${formatAmount(addResult.amount)}`
      );

      return;
    }


    /*
     * ADD itself is valid and confirmed,
     * but returned summary is unusable.
     *
     * We may safely request SUMMARY because
     * SUMMARY is read-only.
     */

    const fallbackSummary =
      await getSummaryWithRetry(
        company,
        3
      );


    if (fallbackSummary) {

      await sendReceiptConfirmation(
        message,
        company,
        Number(
          addResult.amount
        ),
        reporter,
        fallbackSummary
      );

      console.log(
        `[RECEIPT SUCCESS + SUMMARY RECOVERY] ${company} ${messageId}`
      );

      return;
    }


    /*
     * ADD was definitely confirmed.
     * Do NOT show System Error.
     */

    await safeReply(
      message,
      [
        `✅ **Receipt Confirmed | 已確認入款：${formatAmount(addResult.amount)}**`,
        '',
        `👤 **Reporter | 報數人：** ${reporter}`,
        '',
        '入款已成功記錄。',
        'Receipt has been recorded successfully.',
        '',
        '⚠️ 今日 Total 暫時無法載入。'
      ].join('\n')
    );

    return;
  }


  /****************************************************************
   * STEP 3
   * ADD RESPONSE FAILED / INVALID
   *
   * CHECK ONLY.
   * NEVER ADD AGAIN.
   ****************************************************************/

  if (needsCheck) {

    const checkResult =
      await checkReceiptWithRetry(
        company,
        messageId,
        CHECK_ATTEMPTS
      );


    /**************************************************************
     * CHECK FOUND
     *
     * This proves the original ADD reached Sheet.
     **************************************************************/

    if (
      checkResult &&
      checkResult.found === true
    ) {

      const summary =
        normalizeSummary(
          checkResult.summary,
          company
        );


      console.log(
        '[ADD VERIFIED BY CHECK]',
        {
          company,
          messageId,
          amount:
            checkResult.amount
        }
      );


      if (summary) {

        await sendReceiptConfirmation(
          message,
          company,
          Number(
            checkResult.amount
          ),
          checkResult.reporter ||
            reporter,
          summary
        );

        console.log(
          `[RECEIPT RECOVERED] ${company} ${messageId}`
        );

        return;
      }


      /*
       * CHECK proves receipt exists.
       * Summary is optional.
       */

      await safeReply(
        message,
        [
          `✅ **Receipt Confirmed | 已確認入款：${formatAmount(checkResult.amount || amount)}**`,
          '',
          `👤 **Reporter | 報數人：** ${checkResult.reporter || reporter}`,
          '',
          '系統已確認這筆入款存在。',
          'Receipt has been verified successfully.',
          '',
          '⚠️ 今日 Total 暫時無法載入。'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * CHECK returned a valid NOT FOUND
     *
     * IMPORTANT:
     * We still NEVER automatically ADD again.
     **************************************************************/

    if (
      checkResult &&
      checkResult.found === false
    ) {

      console.error(
        '[ADD NOT FOUND AFTER CHECK]',
        company,
        messageId
      );

      await safeReply(
        message,
        [
          '⏳ **Receipt Pending Verification | 入款狀態待確認**',
          '',
          `Amount | 金額：**${formatAmount(amount)}**`,
          '',
          '目前尚未確認這筆記錄。',
          'The receipt has not been confirmed yet.',
          '',
          '**請勿重新報數。**',
          '**Please do NOT repost the amount.**',
          '',
          '如有需要，管理員可檢查 Sheet。'
        ].join('\n')
      );

      return;
    }


    /**************************************************************
     * CHECK itself unavailable / ambiguous
     **************************************************************/

    await safeReply(
      message,
      [
        '⏳ **Receipt Pending Verification | 入款狀態待確認**',
        '',
        `Amount | 金額：**${formatAmount(amount)}**`,
        '',
        '系統暫時無法完成自動確認。',
        'Automatic verification is temporarily unavailable.',
        '',
        '**請勿重新報數。**',
        '**Please do NOT repost the amount.**',
        '',
        '請管理員檢查 Sheet。'
      ].join('\n')
    );

  }

}


/******************************************************************
 * STRICT ADD RESULT VALIDATION
 ******************************************************************/

function isValidAddResult(
  result,
  company,
  messageId
) {

  if (
    !result ||
    typeof result !== 'object'
  ) {
    return false;
  }

  if (
    result.ok !== true
  ) {
    return false;
  }

  if (
    result.company !== company
  ) {
    return false;
  }

  if (
    String(
      result.messageId || ''
    ) !==
    String(messageId)
  ) {
    return false;
  }

  if (
    typeof result.duplicate !==
    'boolean'
  ) {
    return false;
  }

  if (
    result.found !== true
  ) {
    return false;
  }

  if (
    typeof result.status !==
    'string'
  ) {
    return false;
  }

  if (
    !Number.isFinite(
      Number(
        result.amount
      )
    )
  ) {
    return false;
  }

  return true;
}


/******************************************************************
 * CHECK WITH RETRY
 *
 * READ ONLY.
 * NEVER writes.
 ******************************************************************/

async function checkReceiptWithRetry(
  company,
  messageId,
  maxAttempts = 3
) {

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {

    try {

      console.log(
        `[CHECK ATTEMPT] ${company} ${messageId} ${attempt}/${maxAttempts}`
      );


      const result =
        await callAppsScript({

          action: 'CHECK',

          company,

          messageId

        });


      console.log(
        '[CHECK RESULT]',
        result
      );


      if (
        isValidCheckResult(
          result,
          company,
          messageId
        )
      ) {

        /*
         * If found = true:
         * stop immediately.
         */

        if (
          result.found === true
        ) {

          console.log(
            `[CHECK FOUND] ${company} ${messageId}`
          );

          return result;
        }


        /*
         * found:false may simply mean
         * Google has not exposed the write yet.
         *
         * Retry before giving up.
         */

        console.log(
          `[CHECK NOT FOUND] ${company} ${messageId} ${attempt}/${maxAttempts}`
        );


        if (
          attempt ===
          maxAttempts
        ) {

          return result;
        }

      } else {

        console.error(
          `[CHECK INVALID RESPONSE] ${company} ${attempt}/${maxAttempts}`,
          result
        );

      }

    } catch (error) {

      console.error(
        `[CHECK FAILED] ${company} ${attempt}/${maxAttempts}`,
        error.message
      );

    }


    if (
      attempt <
      maxAttempts
    ) {

      /*
       * Retry delays:
       *
       * after attempt 1 -> 1 second
       * after attempt 2 -> 2 seconds
       */

      const waitMs =
        attempt * 1000;

      console.log(
        `[CHECK RETRY] ${company} in ${waitMs}ms`
      );

      await sleep(
        waitMs
      );

    }

  }


  console.error(
    `[CHECK GIVE UP] ${company} ${messageId}`
  );

  return null;
}


/******************************************************************
 * STRICT CHECK VALIDATION
 ******************************************************************/

function isValidCheckResult(
  result,
  company,
  messageId
) {

  if (
    !result ||
    typeof result !== 'object'
  ) {
    return false;
  }

  if (
    result.ok !== true
  ) {
    return false;
  }

  if (
    result.company !== company
  ) {
    return false;
  }

  if (
    String(
      result.messageId || ''
    ) !==
    String(messageId)
  ) {
    return false;
  }

  if (
    typeof result.found !==
    'boolean'
  ) {
    return false;
  }


  /*
   * NOT FOUND is already a valid CHECK response.
   */

  if (
    result.found === false
  ) {
    return true;
  }


  /*
   * FOUND must contain the expected receipt data.
   */

  if (
    !Number.isFinite(
      Number(
        result.amount
      )
    )
  ) {
    return false;
  }

  if (
    typeof result.status !==
    'string'
  ) {
    return false;
  }

  return true;
}


/******************************************************************
 * SUMMARY WITH RETRY
 *
 * READ ONLY.
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


      const summary =
        normalizeSummary(
          result,
          company
        );


      if (summary) {

        console.log(
          `[SUMMARY SUCCESS] ${company} ${attempt}/${maxAttempts}`
        );

        return summary;
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

      const waitMs =
        attempt * 1000;

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
 * STRICT SUMMARY VALIDATION
 ******************************************************************/

function normalizeSummary(
  summary,
  company
) {

  if (
    !summary ||
    typeof summary !== 'object'
  ) {
    return null;
  }

  if (
    summary.ok !== true
  ) {
    return null;
  }

  if (
    summary.company !== company
  ) {
    return null;
  }

  if (
    typeof summary.businessDate !==
    'string'
  ) {
    return null;
  }

  if (
    !Array.isArray(
      summary.entries
    )
  ) {
    return null;
  }

  if (
    !Number.isFinite(
      Number(
        summary.totalAmount
      )
    )
  ) {
    return null;
  }

  if (
    !Number.isFinite(
      Number(
        summary.count
      )
    )
  ) {
    return null;
  }


  return {
    ok: true,

    company:
      summary.company,

    businessDate:
      summary.businessDate,

    count:
      Number(
        summary.count
      ),

    entries:
      summary.entries,

    totalAmount:
      Number(
        summary.totalAmount
      )
  };
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
     * Receipt is already verified.
     * Never call this a System Error.
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
     * If user replies to Bot confirmation,
     * trace back to original +amount message.
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


    /**************************************************************
     * VOID IS SENT ONCE ONLY.
     **************************************************************/

    let result;


    try {

      result =
        await callAppsScript({

          action: 'VOID',

          company,

          targetMessageId:
            originalMessageId,

          voidMessageId:
            message.id,

          voidedBy

        });

    } catch (error) {

      console.error(
        '[VOID RESPONSE FAILED]',
        company,
        originalMessageId,
        error.message
      );


      /*
       * We cannot safely repeat VOID.
       */

      await sendVoidPending(
        message
      );

      return;
    }


    console.log(
      '[VOID RESULT]',
      result
    );


    /**************************************************************
     * EXPLICIT NOT FOUND
     **************************************************************/

    if (
      result &&
      result.ok === false &&
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

      return;
    }


    /**************************************************************
     * STRICT VOID RESPONSE VALIDATION
     *
     * Health response with only ok:true is rejected.
     **************************************************************/

    if (
      !isValidVoidResult(
        result,
        company,
        originalMessageId
      )
    ) {

      console.error(
        '[VOID RESPONSE INVALID / AMBIGUOUS]',
        result
      );

      await sendVoidPending(
        message
      );

      return;
    }


    /**************************************************************
     * ALREADY VOIDED
     **************************************************************/

    if (
      result.alreadyVoided === true
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
     * VOID SUCCESS
     **************************************************************/

    if (
      result.voided === true
    ) {

      let summary =
        normalizeSummary(
          result.summary,
          company
        );


      /*
       * If VOID is confirmed but summary is missing,
       * SUMMARY can safely be queried because it is read-only.
       */

      if (!summary) {

        summary =
          await getSummaryWithRetry(
            company,
            3
          );

      }


      if (!summary) {

        await safeReply(
          message,
          [
            `♻️ **Voided Successfully | 已撤銷：${formatAmount(result.amount)}**`,
            '',
            '撤銷已成功記錄。',
            'Void recorded successfully.',
            '',
            '⚠️ 今日 Total 暫時無法載入。'
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

      return;
    }


    /*
     * Defensive fallback.
     */

    await sendVoidPending(
      message
    );


  } catch (error) {

    console.error(
      '[HANDLE VOID ERROR]',
      error
    );

    await sendVoidPending(
      message
    );

  }

}


/******************************************************************
 * STRICT VOID VALIDATION
 ******************************************************************/

function isValidVoidResult(
  result,
  company,
  messageId
) {

  if (
    !result ||
    typeof result !== 'object'
  ) {
    return false;
  }

  if (
    result.ok !== true
  ) {
    return false;
  }

  if (
    result.company !== company
  ) {
    return false;
  }

  if (
    String(
      result.messageId || ''
    ) !==
    String(messageId)
  ) {
    return false;
  }


  const hasVoided =
    typeof result.voided ===
    'boolean';

  const hasAlreadyVoided =
    typeof result.alreadyVoided ===
    'boolean';


  if (
    !hasVoided ||
    !hasAlreadyVoided
  ) {
    return false;
  }


  if (
    result.voided !== true &&
    result.alreadyVoided !== true
  ) {
    return false;
  }


  if (
    !Number.isFinite(
      Number(
        result.amount
      )
    )
  ) {
    return false;
  }


  return true;
}


/******************************************************************
 * VOID PENDING
 ******************************************************************/

async function sendVoidPending(
  message
) {

  await safeReply(
    message,
    [
      '⏳ **Void Pending Verification | 撤銷狀態待確認**',
      '',
      '目前無法安全確認 Google 回傳結果。',
      '',
      '**請勿重複撤銷。**',
      'Please do NOT repeat the void request.',
      '',
      '請管理員檢查 Sheet 的 Status。'
    ].join('\n')
  );

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
        2000
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
      !trimmed
    ) {

      throw new Error(
        'Apps Script returned empty response'
      );

    }


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

    clearTimeout(
      timeout
    );

  }

}


/******************************************************************
 * PARSE AMOUNT
 *
 * REQUIRED:
 *
 * +1
 * +1.23
 * +100
 * +1,000.50
 *
 * Plain:
 *
 * 100
 *
 * is ignored.
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
    !text.startsWith('+')
  ) {
    return null;
  }


  const amountText =
    text.slice(1).trim();


  if (
    !amountText ||
    amountText.includes('\n') ||
    amountText.includes('\r')
  ) {
    return null;
  }


  const amountRegex =
    /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;


  if (
    !amountRegex.test(
      amountText
    )
  ) {
    return null;
  }


  const normalized =
    amountText.replace(
      /,/g,
      ''
    );


  const amount =
    Number(
      normalized
    );


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

  const number =
    Number(
      value || 0
    );


  if (
    !Number.isFinite(number)
  ) {

    return '0.00';

  }


  return number.toLocaleString(
    'en-MY',
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
