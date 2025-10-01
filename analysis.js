/**
 * Google Apps Script for analyzing Google Drive files with Vertex AI
 * and extracting bank/branch codes using zengin-code data
 */

// Configuration
// 注意: 実際の使用時は Google Apps Script のプロパティサービスで機密情報を設定してください
// 設定方法: スクリプトエディタ → プロジェクトのプロパティ → スクリプトのプロパティ

const GCP_PROJECT_NUMBER = PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_NUMBER') || 'your_project_number_here';
const UNPROCESSED_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('UNPROCESSED_FOLDER_ID') || 'your_unprocessed_folder_id_here';
const PROCESSED_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('PROCESSED_FOLDER_ID') || 'your_processed_folder_id_here';
const CSV_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('CSV_FOLDER_ID') || 'your_csv_folder_id_here';
const VERTEX_AI_URL = `https://us-central1-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_NUMBER}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;

// Slack Configuration
const SLACK_BOT_TOKEN = PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || 'your_slack_bot_token_here';
const SLACK_CHANNEL_ID = PropertiesService.getScriptProperties().getProperty('SLACK_CHANNEL_ID') || 'your_slack_channel_id_here';
const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';

/**
 * Slack通知機能
 * @param {string} message - 送信メッセージ
 * @param {Object} blocks - Slack Blocks（オプション）
 * @param {Object} attachments - Slack Attachments（オプション）
 */
function sendSlackNotification(message, blocks = null, attachments = null) {
  try {
    // メッセージが空の場合はデフォルトメッセージを使用
    if (!message || message === 'undefined') {
      message = '請求書処理システムからの通知';
    }
    
    Logger.log('Slack通知送信中: ' + message);
    
    const payload = {
      channel: SLACK_CHANNEL_ID,
      text: message
    };
    
    if (blocks) {
      payload.blocks = blocks;
    }
    
    if (attachments) {
      payload.attachments = attachments;
    }
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SLACK_BOT_TOKEN,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    };
    
    const response = UrlFetchApp.fetch(SLACK_API_URL, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (responseData.ok) {
      Logger.log('Slack通知送信成功');
      return true;
    } else {
      Logger.log('Slack通知送信失敗: ' + responseData.error);
      Logger.log('レスポンス詳細: ' + JSON.stringify(responseData));
      return false;
    }
    
  } catch (error) {
    Logger.log('Slack通知エラー: ' + error.toString());
    return false;
  }
}

/**
 * 項目不足通知（Slack）
 * @param {Object} missingFields - 不足している項目
 * @param {string} fileName - ファイル名
 * @param {string} fileUrl - ファイルURL
 */
function sendMissingFieldsNotification(missingFields, fileName, fileUrl) {
  const fields = missingFields.join(', ');
  const message = `⚠️ 項目不足: ${fileName}\n不足項目: ${fields}`;
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ 請求書処理エラー*\n\n*ファイル名:* ${fileName}\n*不足項目:* ${fields}`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "ファイルを確認"
          },
          url: fileUrl,
          style: "primary"
        }
      ]
    }
  ];
  
  sendSlackNotification(message, blocks);
}

/**
 * 対話承認型通知（振込期限チェック）
 * @param {string} companyName - 会社名
 * @param {number} daysLeft - 残り日数
 * @param {string} fileName - ファイル名
 * @param {string} fileUrl - ファイルURL
 */
function sendUrgentPaymentNotification(companyName, daysLeft, fileName, fileUrl) {
  const message = `🚨 緊急: ${companyName}の振込期限が${daysLeft}日後です`;
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🚨 緊急振込期限通知*\n\n*会社名:* ${companyName}\n*残り日数:* ${daysLeft}日\n*ファイル名:* ${fileName}`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "個別発行"
          },
          action_id: "individual_issue",
          style: "primary"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "まとめる"
          },
          action_id: "merge"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "保留"
          },
          action_id: "hold",
          style: "danger"
        }
      ]
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${fileUrl}|ファイルを確認>`
        }
      ]
    }
  ];
  
  sendSlackNotification(message, blocks);
}

/**
 * 対話承認型通知（重複チェック）
 * @param {string} companyName - 会社名
 * @param {string} fileName - ファイル名
 * @param {string} fileUrl - ファイルURL
 */
function sendDuplicateCompanyNotification(companyName, fileName, fileUrl) {
  const message = `⚠️ 重複: ${companyName}が既に月末振込用CSVに存在します`;
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ 重複会社検出*\n\n*会社名:* ${companyName}\n*ファイル名:* ${fileName}\n\n月末振込用csv内に同じ会社が存在します。`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "わける"
          },
          action_id: "separate",
          style: "primary"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "まとめる"
          },
          action_id: "merge_amount"
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "保留"
          },
          action_id: "hold",
          style: "danger"
        }
      ]
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${fileUrl}|ファイルを確認>`
        }
      ]
    }
  ];
  
  sendSlackNotification(message, blocks);
}

/**
 * 成功通知
 * @param {Object} invoiceData - 請求書データ
 * @param {string} fileName - ファイル名
 * @param {string} fileUrl - ファイルURL
 */
function sendSuccessNotification(invoiceData, fileName, fileUrl) {
  const message = `✅ 請求書処理完了: ${invoiceData.companyName}`;
  
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ 請求書処理完了*\n\n*会社名:* ${invoiceData.companyName}\n*銀行:* ${invoiceData.bankName}\n*支店:* ${invoiceData.branchName}\n*預金種目:* ${invoiceData.accountType}\n*口座番号:* ${invoiceData.accountNumber || '不明'}\n*受取人名:* ${invoiceData.recipientName}\n*振込金額:* ${invoiceData.amount}円\n*振込期限:* ${invoiceData.deadline}\n*統一金融機関番号:* ${invoiceData.unifiedBankCode}\n*統一店舗番号:* ${invoiceData.unifiedBranchCode}`
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${fileUrl}|ファイルを確認>`
        }
      ]
    }
  ];
  
  sendSlackNotification(message, blocks);
}

/**
 * Vertex AI API認証テスト
 */
function testVertexAI() {
  try {
    Logger.log('=== Vertex AI認証テスト開始 ===');
    
    const testPayload = {
      contents: [{
        role: "user",
        parts: [{
          text: "こんにちは、テストです。"
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 100,
      }
    };

    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(testPayload),
      muteHttpExceptions: true
    };

    Logger.log('テストリクエスト送信中...');
    Logger.log('URL: ' + VERTEX_AI_URL);
    Logger.log('認証トークン: ' + ScriptApp.getOAuthToken().substring(0, 20) + '...');
    
    const response = UrlFetchApp.fetch(VERTEX_AI_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    Logger.log('応答コード: ' + responseCode);
    Logger.log('応答内容: ' + responseText);
    
    if (responseCode === 200) {
      Logger.log('Vertex AI認証テスト成功！');
      const responseData = JSON.parse(responseText);
      if (responseData.candidates && responseData.candidates[0]) {
        Logger.log('テスト応答: ' + responseData.candidates[0].content.parts[0].text);
      }
    } else {
      Logger.log('Vertex AI認証テスト失敗');
      Logger.log('エラー詳細: ' + responseText);
    }
    
  } catch (error) {
    Logger.log('認証テストエラー: ' + error.toString());
  }
}

/**
 * 請求書処理のメイン関数
 */
function main() {
  try {
    Logger.log('=== 請求書処理システム開始 ===');
    
    // 1. フォルダの詳細診断
    diagnoseFolder(UNPROCESSED_FOLDER_ID);
    
    // 2. フォルダ内のファイル一覧を取得
    const files = getFilesInFolder(UNPROCESSED_FOLDER_ID);
    if (!files || files.length === 0) {
      Logger.log('フォルダ内にファイルが見つかりません。');
      return;
    }
    
    Logger.log('フォルダ内に ' + files.length + ' 個のファイルが見つかりました');
    
    // 3. 各ファイルを請求書として処理
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      Logger.log('\n=== 請求書処理 ' + (i + 1) + '/' + files.length + ': ' + file.getName() + ' ===');
      
      try {
        processInvoiceFile(file);
      } catch (fileError) {
        Logger.log('請求書処理エラー: ' + fileError.toString());
        // エラーファイルを処理不可フォルダに移動
        moveFileToProcessedFolder(file);
        continue; // 次のファイルを処理
      }
    }
    
    Logger.log('\n=== 全ての請求書処理完了 ===');
    
  } catch (error) {
    Logger.log('エラーが発生しました: ' + error.toString());
    Logger.log('スタックトレース: ' + error.stack);
  }
}

/**
 * 請求書ファイルを処理
 * @param {File} file - Google Driveファイル
 */
function processInvoiceFile(file) {
  try {
    Logger.log('請求書ファイル処理開始: ' + file.getName());
    
    // 1. ファイル内容を取得
    const fileContent = getFileContentFromFile(file);
    if (!fileContent) {
      Logger.log('ファイル内容の取得に失敗しました');
      moveFileToProcessedFolder(file);
      return;
    }
    
    // 2. 請求書の詳細項目を抽出
    const invoiceData = extractInvoiceData(fileContent, file);
    if (!invoiceData) {
      Logger.log('請求書データの抽出に失敗しました');
      moveFileToProcessedFolder(file);
      return;
    }
    
    // 3. 必須項目のチェック
    const missingFields = validateInvoiceData(invoiceData);
    if (missingFields.length > 0) {
      Logger.log('必須項目が不足しています: ' + missingFields.join(', '));
      sendMissingFieldsNotification(missingFields, file.getName(), file.getUrl());
      moveFileToProcessedFolder(file);
      return;
    }
    
    // 4. 統一金融機関番号・統一店舗番号を検索
    const unifiedCodes = getUnifiedBankCodes(invoiceData.bankName, invoiceData.branchName);
    if (!unifiedCodes) {
      Logger.log('統一金融機関番号・統一店舗番号の取得に失敗しました');
      const fileName = file ? file.getName() : '不明なファイル';
      sendSlackNotification(`統一金融機関番号取得失敗: ${fileName}`, null, null);
      if (file) {
        moveFileToProcessedFolder(file);
      }
      return;
    }
    
    // 5. 統一コードを追加
    invoiceData.unifiedBankCode = unifiedCodes.unifiedBankCode;
    invoiceData.unifiedBranchCode = unifiedCodes.unifiedBranchCode;
    
    // 6. CSV処理
    const csvResult = processCSV(invoiceData, file);
    if (!csvResult.success) {
      Logger.log('CSV処理に失敗しました: ' + csvResult.reason);
      return;
    }
    
    // 7. 成功通知
    sendSuccessNotification(invoiceData, file.getName(), file.getUrl());
    
    Logger.log('請求書処理完了: ' + file.getName());
    
  } catch (error) {
    Logger.log('請求書処理エラー: ' + error.toString());
    throw error;
  }
}


/**
 * Google Docsファイルをテキストに変換
 * @param {File} file - Google Driveファイル
 * @returns {string} 変換されたテキスト
 */
function convertGoogleDocToString(file) {
  try {
    // Google Docsの場合、exportAsメソッドを使用
    const blob = file.getBlob().setContentType('text/plain');
    return blob.getDataAsString();
  } catch (error) {
    Logger.log('Google Docs変換エラー: ' + error.toString());
    return null;
  }
}

/**
 * 請求書データを抽出
 * @param {string} content - ファイル内容
 * @returns {Object} 請求書データ
 */
function extractInvoiceData(content, file = null) {
  try {
    Logger.log('請求書データ抽出開始...');
    
    // Vertex AIで請求書データを抽出
    const analysisResult = analyzeInvoiceWithVertexAI(content, file);
    let invoiceData = null;
    
    if (analysisResult) {
      invoiceData = parseInvoiceAnalysisResult(analysisResult);
      Logger.log('Vertex AI抽出結果: ' + JSON.stringify(invoiceData));
    }
    
    // Vertex AIが失敗した場合はパターンマッチングで抽出
    if (!invoiceData) {
      Logger.log('Vertex AI分析に失敗したため、パターンマッチングで抽出を試行します');
      invoiceData = extractInvoiceDataFromText(content);
      Logger.log('パターンマッチング抽出結果: ' + JSON.stringify(invoiceData));
    }
    
    return invoiceData;
    
  } catch (error) {
    Logger.log('請求書データ抽出エラー: ' + error.toString());
    return null;
  }
}

/**
 * Vertex AIで請求書データを抽出
 * @param {string} content - ファイル内容
 * @returns {string} 分析結果
 */
function analyzeInvoiceWithVertexAI(content, file = null) {
  try {
    let payload;
    
    // PDFファイルの場合は直接ファイルを送信
    if (content === 'PDF_FILE' && file) {
      Logger.log('PDFファイルをVertex AIに直接送信中...');
      
      // PDFファイルをBase64エンコード
      const pdfBlob = file.getBlob();
      const base64Data = Utilities.base64Encode(pdfBlob.getBytes());
      
      payload = {
        contents: [{
          role: "user",
          parts: [{
            inline_data: {
              mime_type: "application/pdf",
              data: base64Data
            }
          }, {
            text: `このPDF請求書を分析して、以下の項目を抽出してください。

以下の形式で回答してください:
発行会社名: [会社名]
振込先銀行: [銀行名]
振込先支店: [支店名]
預金種目: [普通/当座/貯蓄/その他]
口座番号: [口座番号]
受取人名: [受取人名（半角カタカナで記載されているものをそのまま抽出）]
振込金額: [金額]
振込期限: [期限日]

重要: 受取人名は口座番号の近くに半角カタカナ（ﾆﾎﾝ ｻﾝﾌﾟﾙ など）で記載されているはずです。
受取人名には「ｶ) ﾆﾎﾝｻﾝﾌﾟﾙ」のように記号や番号が付いている場合があります。その記号や番号も含めて完全にそのまま抽出してください。
注意: 受取人名は必ず半角カタカナ（ｶｷｸｹｺなど）で記載されています。全角カタカナ（カキクケコなど）ではなく、半角カタカナで抽出してください。
各項目が見つからない場合は「不明」と記載してください。`
          }]
        }]
      };
    } else {
      // テキストファイルの場合
      payload = {
        contents: [{
          role: "user",
          parts: [{
            text: `以下の請求書内容を分析して、以下の項目を抽出してください。

請求書内容:
${content}

以下の形式で回答してください:
発行会社名: [会社名]
振込先銀行: [銀行名]
振込先支店: [支店名]
預金種目: [普通/当座/貯蓄/その他]
口座番号: [口座番号]
受取人名: [受取人名（半角カタカナで記載されているものをそのまま抽出）]
振込金額: [金額]
振込期限: [期限日]

重要: 受取人名は口座番号の近くに半角カタカナ（ﾆﾎﾝ ｻﾝﾌﾟﾙ など）で記載されているはずです。
受取人名には「ｶ) ﾆﾎﾝｻﾝﾌﾟﾙ」のように記号や番号が付いている場合があります。その記号や番号も含めて完全にそのまま抽出してください。
注意: 受取人名は必ず半角カタカナ（ｶｷｸｹｺなど）で記載されています。全角カタカナ（カキクケコなど）ではなく、半角カタカナで抽出してください。
各項目が見つからない場合は「不明」と記載してください。`
          }]
        }]
      };
    }
    
    // 共通の設定を追加
    payload.generationConfig = {
      temperature: 0.1,
      topK: 32,
      topP: 1,
      maxOutputTokens: 1024,
    };

    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    Logger.log('Vertex AI請求書分析中...');
    const response = UrlFetchApp.fetch(VERTEX_AI_URL, options);
    const responseText = response.getContentText();
    
    Logger.log('Vertex AI応答コード: ' + response.getResponseCode());
    
    if (response.getResponseCode() !== 200) {
      Logger.log('Vertex AIエラー応答: ' + responseText);
      return null;
    }
    
    const responseData = JSON.parse(responseText);
    
    if (responseData.candidates && responseData.candidates[0] && responseData.candidates[0].content) {
      const result = responseData.candidates[0].content.parts[0].text;
      Logger.log('Vertex AI請求書分析結果: ' + result);
      return result;
    } else {
      Logger.log('Vertex AI応答エラー: ' + JSON.stringify(responseData));
      return null;
    }
    
  } catch (error) {
    Logger.log('Vertex AI請求書分析エラー: ' + error.toString());
    return null;
  }
}

/**
 * Vertex AI分析結果をパース
 * @param {string} analysisResult - Vertex AIの分析結果
 * @returns {Object} 請求書データ
 */
function parseInvoiceAnalysisResult(analysisResult) {
  try {
    const lines = analysisResult.split('\n');
    const invoiceData = {};
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.includes('発行会社名:')) {
        invoiceData.companyName = trimmedLine.replace('発行会社名:', '').trim();
      } else if (trimmedLine.includes('振込先銀行:')) {
        invoiceData.bankName = trimmedLine.replace('振込先銀行:', '').trim();
      } else if (trimmedLine.includes('振込先支店:')) {
        invoiceData.branchName = trimmedLine.replace('振込先支店:', '').trim();
      } else if (trimmedLine.includes('預金種目:')) {
        invoiceData.accountType = trimmedLine.replace('預金種目:', '').trim();
      } else if (trimmedLine.includes('口座番号:')) {
        invoiceData.accountNumber = trimmedLine.replace('口座番号:', '').trim();
      } else if (trimmedLine.includes('受取人名:')) {
        invoiceData.recipientName = trimmedLine.replace('受取人名:', '').trim();
      } else if (trimmedLine.includes('振込金額:')) {
        invoiceData.amount = trimmedLine.replace('振込金額:', '').trim();
      } else if (trimmedLine.includes('振込期限:')) {
        invoiceData.deadline = trimmedLine.replace('振込期限:', '').trim();
      }
    }
    
    // 預金種目を数値に変換
    if (invoiceData.accountType) {
      invoiceData.accountTypeCode = convertAccountTypeToCode(invoiceData.accountType);
    }
    
    // 受取人名が全角カタカナの場合は半角カタカナに変換
    if (invoiceData.recipientName && !invoiceData.recipientName.match(/[ｱ-ﾝ]/)) {
      Logger.log('受取人名が全角カタカナのため半角カタカナに変換: ' + invoiceData.recipientName);
      invoiceData.recipientName = convertToHalfWidthKatakana(invoiceData.recipientName);
      Logger.log('変換後: ' + invoiceData.recipientName);
    }
    
    return invoiceData;
    
  } catch (error) {
    Logger.log('請求書分析結果パースエラー: ' + error.toString());
    return null;
  }
}

/**
 * 請求書データをテキストから抽出（パターンマッチング）
 * @param {string} text - ファイル内容
 * @returns {Object} 請求書データ
 */
function extractInvoiceDataFromText(text) {
  try {
    Logger.log('パターンマッチングで請求書データを抽出中...');
    
    const invoiceData = {};
    
    // 会社名の抽出
    const companyPatterns = [
      /発行会社[：:]\s*(.+)/i,
      /請求先[：:]\s*(.+)/i,
      /株式会社\s*([^\\n\\r]+)/i,
      /有限会社\s*([^\\n\\r]+)/i
    ];
    
    for (const pattern of companyPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        invoiceData.companyName = match[1].trim();
        break;
      }
    }
    
    // 振込先銀行・支店の抽出
    const bankPattern = /(.+銀行)\s*[-\s]\s*(.+支店|.+出張所|.+営業部)/i;
    const bankMatch = text.match(bankPattern);
    if (bankMatch) {
      invoiceData.bankName = bankMatch[1].trim();
      invoiceData.branchName = bankMatch[2].trim();
    }
    
    // 預金種目の抽出
    const accountPatterns = [
      /預金種目[：:]\s*(普通|当座|貯蓄|その他)/i,
      /口座種別[：:]\s*(普通|当座|貯蓄|その他)/i,
      /(普通|当座|貯蓄)口座/i
    ];
    
    for (const pattern of accountPatterns) {
      const match = text.match(pattern);
      if (match) {
        invoiceData.accountType = match[1].trim();
        break;
      }
    }
    
    // 口座番号の抽出
    const accountNumberPatterns = [
      /口座番号[：:]\s*(\d+)/i,
      /口座[：:]\s*(\d+)/i,
      /番号[：:]\s*(\d+)/i,
      /(\d{7,})/g // 7桁以上の数字
    ];
    
    for (const pattern of accountNumberPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        invoiceData.accountNumber = match[1].trim();
        break;
      }
    }
    
    // 受取人名の抽出（半角カタカナを優先、記号付きも含む）
    const recipientPatterns = [
      /受取人名[：:]\s*(.+)/i,
      /口座名義[：:]\s*(.+)/i,
      /名義人[：:]\s*(.+)/i,
      /([ｱ-ﾝﾞﾟ\)\s]+)/g, // 半角カタカナ + 記号のパターン
      /([ｶ-ﾝﾞﾟ\)\s]+)/g, // 半角カタカナ + 記号のパターン（ｶから始まる）
      /([ﾞﾟｱ-ﾝ\s]+)/g // 半角カタカナのパターン
    ];
    
    for (const pattern of recipientPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        invoiceData.recipientName = match[1].trim();
        break;
      }
    }
    
    // 振込金額の抽出
    const amountPatterns = [
      /振込金額[：:]\s*([0-9,]+)/i,
      /金額[：:]\s*([0-9,]+)/i,
      /請求金額[：:]\s*([0-9,]+)/i,
      /合計[：:]\s*([0-9,]+)/i
    ];
    
    for (const pattern of amountPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        invoiceData.amount = match[1].trim();
        break;
      }
    }
    
    // 振込期限の抽出
    const deadlinePatterns = [
      /振込期限[：:]\s*(.+)/i,
      /支払期限[：:]\s*(.+)/i,
      /期限[：:]\s*(.+)/i
    ];
    
    for (const pattern of deadlinePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        invoiceData.deadline = match[1].trim();
        break;
      }
    }
    
    // 預金種目を数値に変換
    if (invoiceData.accountType) {
      invoiceData.accountTypeCode = convertAccountTypeToCode(invoiceData.accountType);
    }
    
    return invoiceData;
    
  } catch (error) {
    Logger.log('請求書データ抽出エラー: ' + error.toString());
    return null;
  }
}

/**
 * 預金種目をコードに変換
 * @param {string} accountType - 預金種目
 * @returns {number} 預金種目コード
 */
function convertAccountTypeToCode(accountType) {
  const type = accountType.toLowerCase();
  if (type.includes('普通') || type.includes('普')) return 1;
  if (type.includes('当座') || type.includes('当')) return 2;
  if (type.includes('貯蓄') || type.includes('貯')) return 4;
  return 9; // その他
}

/**
 * Vertex AIでファイル内容を分析（複数の金融機関情報を抽出）
 * @param {string} content - ファイル内容
 * @returns {string} 分析結果
 */
function analyzeWithVertexAI(content) {
  try {
    const payload = {
      contents: [{
        role: "user",
        parts: [{
          text: `以下のファイル内容を分析して、全ての金融機関名と支店名を抽出してください。

ファイル内容:
${content}

以下の形式で回答してください（複数ある場合は全て抽出）:
1. 金融機関名: [機関名1] - 支店名: [支店名1]
2. 金融機関名: [機関名2] - 支店名: [支店名2]
3. 金融機関名: [機関名3] - 支店名: [支店名3]
...

ハイフン区切りで記載されている金融機関と支店の組み合わせを全て抽出してください。`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        topK: 32,
        topP: 1,
        maxOutputTokens: 2048,
      }
    };

    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    Logger.log('Vertex AIにリクエストを送信中...');
    const response = UrlFetchApp.fetch(VERTEX_AI_URL, options);
    const responseText = response.getContentText();
    
    Logger.log('Vertex AI応答コード: ' + response.getResponseCode());
    
    if (response.getResponseCode() !== 200) {
      Logger.log('Vertex AIエラー応答: ' + responseText);
      return null;
    }
    
    const responseData = JSON.parse(responseText);
    
    if (responseData.candidates && responseData.candidates[0] && responseData.candidates[0].content) {
      const result = responseData.candidates[0].content.parts[0].text;
      Logger.log('Vertex AI分析結果: ' + result);
      return result;
    } else {
      Logger.log('Vertex AI応答エラー: ' + JSON.stringify(responseData));
      return null;
    }
    
  } catch (error) {
    Logger.log('Vertex AI分析エラー: ' + error.toString());
    return null;
  }
}

/**
 * Vertex AIの分析結果から複数の金融機関情報を抽出
 * @param {string} analysisResult - Vertex AIの分析結果
 * @returns {Array} 金融機関情報の配列 [{bankName, branchName}]
 */
function extractAllBankInfosFromAI(analysisResult) {
  try {
    Logger.log('Vertex AI結果から複数の金融機関情報を抽出中...');
    
    const bankInfos = [];
    const lines = analysisResult.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // "金融機関名: XXX - 支店名: YYY" の形式を検索
      const match = trimmedLine.match(/金融機関名:\s*(.+?)\s*-\s*支店名:\s*(.+)$/);
      if (match) {
        const bankName = match[1].trim();
        const branchName = match[2].trim();
        
        if (isValidBankName(bankName) && isValidBranchName(branchName)) {
          bankInfos.push({ bankName, branchName });
          Logger.log('AI抽出: ' + bankName + ' - ' + branchName);
        }
      }
    }
    
    // 重複を除去
    const uniqueBankInfos = removeDuplicateBankInfos(bankInfos);
    
    Logger.log('AI抽出完了: ' + uniqueBankInfos.length + '件の金融機関情報');
    return uniqueBankInfos;
    
  } catch (error) {
    Logger.log('AI結果抽出エラー: ' + error.toString());
    return [];
  }
}

/**
 * 分析結果から金融機関情報を抽出
 * @param {string} analysisResult - Vertex AIの分析結果
 * @returns {Object} 金融機関情報 {bankName, branchName}
 */
function extractBankInfo(analysisResult) {
  try {
    const lines = analysisResult.split('\n');
    let bankName = '';
    let branchName = '';
    
    for (const line of lines) {
      if (line.includes('金融機関名:')) {
        bankName = line.replace('金融機関名:', '').trim();
      } else if (line.includes('支店名:')) {
        branchName = line.replace('支店名:', '').trim();
      }
    }
    
    if (bankName && branchName) {
      return { bankName, branchName };
    } else {
      Logger.log('金融機関名または支店名が抽出できませんでした');
      return null;
    }
    
  } catch (error) {
    Logger.log('情報抽出エラー: ' + error.toString());
    return null;
  }
}

/**
 * テキストから直接金融機関情報を抽出（パターンマッチング）
 * @param {string} text - ファイル内容
 * @returns {Object} 金融機関情報 {bankName, branchName}
 */
function extractBankInfoFromText(text) {
  try {
    Logger.log('パターンマッチングで金融機関情報を抽出中...');
    
    // 主要な金融機関名のパターン
    const bankPatterns = [
      /三菱UFJ銀行/g,
      /三井住友銀行/g,
      /みずほ銀行/g,
      /ゆうちょ銀行/g,
      /滋賀銀行/g,
      /京都信用金庫/g,
      /滋賀県信用組合/g,
      /京滋信用組合/g,
      /楽天銀行/g,
      /(.*銀行)/g,
      /(.*信用金庫)/g,
      /(.*信用組合)/g
    ];
    
    // 支店名のパターン
    const branchPatterns = [
      /本店/g,
      /本店営業部/g,
      /本店第一出張所/g,
      /大津支店/g,
      /彦根支店/g,
      /西京極支店/g,
      /草津支店/g,
      /〇一八支店/g,
      /ジャズ支店/g,
      /ロック/g,
      /([^-]+支店)/g,
      /([^-]+出張所)/g,
      /([^-]+営業部)/g
    ];
    
    let bankName = '';
    let branchName = '';
    
    // 金融機関名を検索
    for (const pattern of bankPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        bankName = matches[0].trim();
        Logger.log('金融機関名を発見: ' + bankName);
        break;
      }
    }
    
    // 支店名を検索
    for (const pattern of branchPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        branchName = matches[0].trim();
        Logger.log('支店名を発見: ' + branchName);
        break;
      }
    }
    
    // ハイフン区切りの形式を検索（例: "三菱UFJ銀行 - 本店"）
    const hyphenPattern = /([^-]+)\s*-\s*([^-]+)/g;
    const hyphenMatches = text.match(hyphenPattern);
    if (hyphenMatches && hyphenMatches.length > 0) {
      const firstMatch = hyphenMatches[0];
      const parts = firstMatch.split('-');
      if (parts.length >= 2) {
        bankName = parts[0].trim();
        branchName = parts[1].trim();
        Logger.log('ハイフン形式から抽出 - 金融機関名: ' + bankName + ', 支店名: ' + branchName);
      }
    }
    
    if (bankName && branchName) {
      return { bankName, branchName };
    } else if (bankName) {
      // 金融機関名のみ見つかった場合は、最初の支店名を探す
      Logger.log('金融機関名のみ発見、支店名を検索中...');
      const lines = text.split('\n');
      for (const line of lines) {
        for (const pattern of branchPatterns) {
          const matches = line.match(pattern);
          if (matches && matches.length > 0) {
            branchName = matches[0].trim();
            Logger.log('支店名を発見: ' + branchName);
            return { bankName, branchName };
          }
        }
      }
    }
    
    Logger.log('金融機関情報の抽出に失敗しました');
    Logger.log('検索したテキスト: ' + text.substring(0, 300));
    return null;
    
  } catch (error) {
    Logger.log('パターンマッチングエラー: ' + error.toString());
    return null;
  }
}

/**
 * テキストから複数の金融機関情報を抽出
 * @param {string} text - ファイル内容
 * @returns {Array} 金融機関情報の配列 [{bankName, branchName}]
 */
function extractAllBankInfos(text) {
  try {
    Logger.log('複数の金融機関情報を抽出中...');
    
    const bankInfos = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      // ハイフン区切りの形式を検索（例: "三菱UFJ銀行 - 本店"）
      const hyphenMatch = trimmedLine.match(/^(.+?)\s*-\s*(.+)$/);
      if (hyphenMatch) {
        const bankName = hyphenMatch[1].trim();
        const branchName = hyphenMatch[2].trim();
        
        // 金融機関名と支店名が有効かチェック
        if (isValidBankName(bankName) && isValidBranchName(branchName)) {
          bankInfos.push({ bankName, branchName });
          Logger.log('抽出: ' + bankName + ' - ' + branchName);
        }
      }
    }
    
    // 重複を除去
    const uniqueBankInfos = removeDuplicateBankInfos(bankInfos);
    
    Logger.log('抽出完了: ' + uniqueBankInfos.length + '件の金融機関情報');
    return uniqueBankInfos;
    
  } catch (error) {
    Logger.log('複数金融機関情報抽出エラー: ' + error.toString());
    return [];
  }
}

/**
 * 金融機関名が有効かチェック
 * @param {string} bankName - 金融機関名
 * @returns {boolean} 有効かどうか
 */
function isValidBankName(bankName) {
  if (!bankName || bankName.length < 2) return false;
  
  const validPatterns = [
    /銀行$/,
    /信用金庫$/,
    /信用組合$/,
    /協同組合$/,
    /信託$/,
    /農協$/
  ];
  
  return validPatterns.some(pattern => pattern.test(bankName));
}

/**
 * 支店名が有効かチェック
 * @param {string} branchName - 支店名
 * @returns {boolean} 有効かどうか
 */
function isValidBranchName(branchName) {
  if (!branchName || branchName.length < 2) return false;
  
  const validPatterns = [
    /支店$/,
    /出張所$/,
    /営業部$/,
    /本店$/,
    /サービスセンター$/,
    /センター$/
  ];
  
  return validPatterns.some(pattern => pattern.test(branchName)) || 
         branchName.includes('支店') || 
         branchName.includes('出張所') ||
         branchName.includes('営業部') ||
         branchName.includes('本店');
}

/**
 * 重複する金融機関情報を除去
 * @param {Array} bankInfos - 金融機関情報の配列
 * @returns {Array} 重複除去後の配列
 */
function removeDuplicateBankInfos(bankInfos) {
  const unique = [];
  const seen = new Set();
  
  for (const info of bankInfos) {
    const key = info.bankName + '|' + info.branchName;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(info);
    }
  }
  
  Logger.log('重複除去: ' + bankInfos.length + '件 → ' + unique.length + '件');
  return unique;
}

/**
 * zengin-codeデータから金融機関コードと支店コードを取得
 * @param {string} bankName - 金融機関名
 * @param {string} branchName - 支店名
 * @returns {Object} {bankCode, branchCode}
 */
function getBankAndBranchCodes(bankName, branchName) {
  try {
    Logger.log('zengin-codeデータを取得中...');
    
    // 金融機関データを取得
    const banksUrl = 'https://raw.githubusercontent.com/zengin-code/source-data/master/data/banks.json';
    const banksResponse = UrlFetchApp.fetch(banksUrl);
    const banksData = JSON.parse(banksResponse.getContentText());
    
    let bankCode = '';
    let branchCode = '';
    
    // 金融機関名の正規化と検索
    const normalizedBankName = normalizeBankName(bankName);
    Logger.log('正規化された金融機関名: ' + normalizedBankName);
    
    // 金融機関名で検索（複数のパターンで試行）
    for (const code in banksData) {
      const bank = banksData[code];
      const bankDataName = bank.name;
      
      // 検索パターン
      const searchPatterns = [
        normalizedBankName,
        bankName,
        extractMainBankName(bankName),
        extractMainBankName(normalizedBankName)
      ];
      
      let found = false;
      for (const pattern of searchPatterns) {
        if (isBankNameMatch(bankDataName, pattern)) {
          bankCode = code;
          Logger.log('金融機関コード発見: ' + code + ' (' + bankDataName + ') - パターン: ' + pattern);
          found = true;
          break;
        }
      }
      
      if (found) {
        // 支店データを取得
        try {
          const branchesUrl = `https://raw.githubusercontent.com/zengin-code/source-data/master/data/branches/${code}.json`;
          const branchesResponse = UrlFetchApp.fetch(branchesUrl);
          const branchesData = JSON.parse(branchesResponse.getContentText());
          
          Logger.log('支店データを取得しました（' + Object.keys(branchesData).length + '件）');
          
          // 支店名で検索（複数のパターンで試行）
          const normalizedBranchName = normalizeBranchName(branchName);
          Logger.log('正規化された支店名: ' + normalizedBranchName);
          
          // 完全一致を優先して検索
          let exactMatch = null;
          let partialMatch = null;
          
          for (const bCode in branchesData) {
            const branch = branchesData[bCode];
            const branchDataName = branch.name;
            
            // 完全一致チェック
            if (branchDataName === branchName || branchDataName === normalizedBranchName) {
              exactMatch = { code: bCode, name: branchDataName };
              Logger.log('完全一致発見: ' + bCode + ' (' + branchDataName + ')');
              break;
            }
            
            // 部分一致チェック（完全一致が見つからない場合のみ）
            if (!exactMatch) {
              const branchSearchPatterns = [
                normalizedBranchName,
                branchName,
                extractMainBranchName(branchName),
                extractMainBranchName(normalizedBranchName)
              ];
              
              for (const pattern of branchSearchPatterns) {
                if (isBranchNameMatch(branchDataName, pattern)) {
                  partialMatch = { code: bCode, name: branchDataName, pattern: pattern };
                  Logger.log('部分一致発見: ' + bCode + ' (' + branchDataName + ') - パターン: ' + pattern);
                  break;
                }
              }
            }
          }
          
          // 結果を設定（完全一致を優先）
          if (exactMatch) {
            branchCode = exactMatch.code;
            Logger.log('支店コード確定（完全一致）: ' + exactMatch.code + ' (' + exactMatch.name + ')');
          } else if (partialMatch) {
            branchCode = partialMatch.code;
            Logger.log('支店コード確定（部分一致）: ' + partialMatch.code + ' (' + partialMatch.name + ') - パターン: ' + partialMatch.pattern);
          }
          
          if (branchCode) break;
        } catch (branchError) {
          Logger.log('支店データ取得エラー: ' + branchError.toString());
        }
        
        break;
      }
    }
    
    if (bankCode && branchCode) {
      return { bankCode, branchCode };
    } else {
      Logger.log('該当するコードが見つかりませんでした');
      Logger.log('検索した金融機関名: ' + bankName);
      Logger.log('検索した支店名: ' + branchName);
      
      // デバッグ用：最初の10件の金融機関名を表示
      Logger.log('デバッグ: 利用可能な金融機関名（最初の10件）:');
      let count = 0;
      for (const code in banksData) {
        if (count >= 10) break;
        Logger.log('  ' + code + ': ' + banksData[code].name);
        count++;
      }
      
      // 主要銀行の検索
      Logger.log('\nデバッグ: 主要銀行の検索:');
      const majorBanks = ['三菱', '三井', 'みずほ', 'UFJ', 'MUFG', '住友', 'SMBC'];
      for (const code in banksData) {
        const bankName = banksData[code].name;
        for (const keyword of majorBanks) {
          if (bankName.includes(keyword)) {
            Logger.log('  見つかった: ' + code + ': ' + bankName);
            break;
          }
        }
      }
      
      return null;
    }
    
  } catch (error) {
    Logger.log('コード取得エラー: ' + error.toString());
    return null;
  }
}

/**
 * 金融機関名を正規化
 * @param {string} bankName - 金融機関名
 * @returns {string} 正規化された金融機関名
 */
function normalizeBankName(bankName) {
  return bankName
    .replace(/銀行/g, '')
    .replace(/株式会社/g, '')
    .replace(/有限会社/g, '')
    .replace(/合資会社/g, '')
    .replace(/合名会社/g, '')
    .replace(/協同組合/g, '')
    .replace(/信用金庫/g, '')
    .replace(/信用組合/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 支店名を正規化
 * @param {string} branchName - 支店名
 * @returns {string} 正規化された支店名
 */
function normalizeBranchName(branchName) {
  return branchName
    .replace(/支店/g, '')
    .replace(/出張所/g, '')
    .replace(/営業部/g, '')
    .replace(/サービスセンター/g, '')
    .replace(/〇/g, '0')
    .replace(/一/g, '1')
    .replace(/二/g, '2')
    .replace(/三/g, '3')
    .replace(/四/g, '4')
    .replace(/五/g, '5')
    .replace(/六/g, '6')
    .replace(/七/g, '7')
    .replace(/八/g, '8')
    .replace(/九/g, '9')
    .replace(/十/g, '10')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 金融機関名の主要部分を抽出
 * @param {string} bankName - 金融機関名
 * @returns {string} 主要部分
 */
function extractMainBankName(bankName) {
  // 三菱UFJ銀行 -> 三菱UFJ
  // 三井住友銀行 -> 三井住友
  // みずほ銀行 -> みずほ
  return bankName.replace(/(銀行|信用金庫|信用組合|協同組合).*$/, '').trim();
}

/**
 * 支店名の主要部分を抽出
 * @param {string} branchName - 支店名
 * @returns {string} 主要部分
 */
function extractMainBranchName(branchName) {
  // 本店第一出張所 -> 本店第一出張所
  // 大津支店 -> 大津
  return branchName.replace(/(支店|出張所|営業部).*$/, '').trim();
}

/**
 * 金融機関名のマッチング判定（強化版）
 * @param {string} dataName - データベースの金融機関名
 * @param {string} searchName - 検索する金融機関名
 * @returns {boolean} マッチするかどうか
 */
function isBankNameMatch(dataName, searchName) {
  if (!dataName || !searchName) return false;
  
  // 1. 完全一致
  if (dataName === searchName) return true;
  
  // 2. 部分一致
  if (dataName.includes(searchName) || searchName.includes(dataName)) return true;
  
  // 3. 大文字小文字を無視した比較
  if (dataName.toLowerCase() === searchName.toLowerCase()) return true;
  if (dataName.toLowerCase().includes(searchName.toLowerCase()) || searchName.toLowerCase().includes(dataName.toLowerCase())) return true;
  
  // 4. 正規化後の比較
  const normalizedDataName = normalizeBankName(dataName);
  const normalizedSearchName = normalizeBankName(searchName);
  
  if (normalizedDataName === normalizedSearchName) return true;
  if (normalizedDataName.includes(normalizedSearchName) || normalizedSearchName.includes(normalizedDataName)) return true;
  
  // 5. 半角全角変換後の比較
  const convertedDataName = convertFullWidthToHalfWidth(dataName);
  const convertedSearchName = convertFullWidthToHalfWidth(searchName);
  
  if (convertedDataName === convertedSearchName) return true;
  if (convertedDataName.includes(convertedSearchName) || convertedSearchName.includes(convertedDataName)) return true;
  
  // 6. 主要部分の比較
  const mainDataName = extractMainBankName(dataName);
  const mainSearchName = extractMainBankName(searchName);
  
  if (mainDataName === mainSearchName) return true;
  if (mainDataName.includes(mainSearchName) || mainSearchName.includes(mainDataName)) return true;
  
  // 7. 英語名・略称での比較
  const englishMappings = {
    'paypay': ['PayPay', 'PAYPAY', 'Paypay'],
    'sbi': ['SBI', 'sbi'],
    'au': ['AU', 'au', 'AUじぶん'],
    'sony': ['Sony', 'SONY', 'sony'],
    'seven': ['Seven', 'SEVEN', 'seven'],
    'aeon': ['Aeon', 'AEON', 'aeon'],
    'rakuten': ['Rakuten', 'RAKUTEN', 'rakuten']
  };
  
  for (const englishKey in englishMappings) {
    const variations = englishMappings[englishKey];
    const dataHasEnglish = variations.some(v => dataName.includes(v));
    const searchHasEnglish = variations.some(v => searchName.includes(v));
    
    if (dataHasEnglish && searchHasEnglish) return true;
  }
  
  return false;
}

/**
 * 支店名のマッチング判定（改善版）
 * @param {string} dataName - データベースの支店名
 * @param {string} searchName - 検索する支店名
 * @returns {boolean} マッチするかどうか
 */
function isBranchNameMatch(dataName, searchName) {
  if (!dataName || !searchName) return false;
  
  // 1. 完全一致（最優先）
  if (dataName === searchName) return true;
  
  // 2. 正規化後の完全一致
  const normalizedDataName = normalizeBranchName(dataName);
  const normalizedSearchName = normalizeBranchName(searchName);
  if (normalizedDataName === normalizedSearchName) return true;
  
  // 3. 長い文字列での部分一致（短い文字列での部分一致は避ける）
  if (searchName.length >= 3) {
    if (dataName.includes(searchName) || searchName.includes(dataName)) return true;
    if (normalizedDataName.includes(normalizedSearchName) || normalizedSearchName.includes(normalizedDataName)) return true;
  }
  
  // 4. 主要部分の比較（長い文字列のみ）
  if (searchName.length >= 4) {
    const mainDataName = extractMainBranchName(dataName);
    const mainSearchName = extractMainBranchName(searchName);
    
    if (mainDataName === mainSearchName) return true;
    if (mainDataName.length >= 3 && mainSearchName.length >= 3) {
      if (mainDataName.includes(mainSearchName) || mainSearchName.includes(mainDataName)) return true;
    }
  }
  
  return false;
}

/**
 * デバッグ用関数 - 特定の支店名を検索
 */
function debugBranchSearch(bankName, branchName) {
  try {
    Logger.log('=== 支店検索デバッグ ===');
    Logger.log('検索対象: ' + bankName + ' - ' + branchName);
    
    // 金融機関コードを取得
    const bankCodes = getBankAndBranchCodes(bankName, 'dummy');
    if (!bankCodes) {
      Logger.log('金融機関コードが見つかりません');
      return;
    }
    
    const bankCode = bankCodes.bankCode;
    Logger.log('金融機関コード: ' + bankCode);
    
    // 支店データを取得
    const branchesUrl = `https://raw.githubusercontent.com/zengin-code/source-data/master/data/branches/${bankCode}.json`;
    const branchesResponse = UrlFetchApp.fetch(branchesUrl);
    const branchesData = JSON.parse(branchesResponse.getContentText());
    
    Logger.log('支店データ件数: ' + Object.keys(branchesData).length);
    
    // 検索対象の支店名に関連する支店を表示
    const relatedBranches = [];
    for (const bCode in branchesData) {
      const branch = branchesData[bCode];
      const branchDataName = branch.name;
      
      if (branchDataName.includes('東京都庁') || branchDataName.includes('東') || branchDataName.includes('出張所')) {
        relatedBranches.push({ code: bCode, name: branchDataName });
      }
    }
    
    Logger.log('関連する支店:');
    for (const branch of relatedBranches) {
      Logger.log('  ' + branch.code + ': ' + branch.name);
    }
    
    // 実際の検索を実行
    const result = getBankAndBranchCodes(bankName, branchName);
    if (result) {
      Logger.log('検索結果: ' + result.bankCode + ' - ' + result.branchCode);
    } else {
      Logger.log('検索結果: 見つかりませんでした');
    }
    
  } catch (error) {
    Logger.log('デバッグエラー: ' + error.toString());
  }
}

/**
 * テスト用関数 - 金融機関コード検索のテスト
 */
function testBankCodeSearch() {
  const testBankName = '三菱UFJ銀行';
  const testBranchName = '本店';
  
  Logger.log('=== テスト開始 ===');
  const codes = getBankAndBranchCodes(testBankName, testBranchName);
  
  if (codes) {
    Logger.log('テスト結果:');
    Logger.log('金融機関コード: ' + codes.bankCode);
    Logger.log('支店コード: ' + codes.branchCode);
  } else {
    Logger.log('テスト失敗: コードが見つかりませんでした');
  }
}

/**
 * zengin-codeデータの内容を確認するデバッグ関数
 */
function debugZenginCodeData() {
  try {
    Logger.log('=== zengin-codeデータデバッグ ===');
    
    // 金融機関データを取得
    const banksUrl = 'https://raw.githubusercontent.com/zengin-code/source-data/master/data/banks.json';
    const banksResponse = UrlFetchApp.fetch(banksUrl);
    const banksData = JSON.parse(banksResponse.getContentText());
    
    Logger.log('金融機関データ総数: ' + Object.keys(banksData).length);
    
    // 三菱UFJ関連を検索
    Logger.log('\n=== 三菱UFJ関連の検索 ===');
    for (const code in banksData) {
      const bank = banksData[code];
      if (bank.name.includes('三菱') || bank.name.includes('UFJ') || bank.name.includes('MUFG')) {
        Logger.log('コード: ' + code + ' - 名前: ' + bank.name);
        
        // 支店データも確認
        try {
          const branchesUrl = `https://raw.githubusercontent.com/zengin-code/source-data/master/data/branches/${code}.json`;
          const branchesResponse = UrlFetchApp.fetch(branchesUrl);
          const branchesData = JSON.parse(branchesResponse.getContentText());
          
          Logger.log('  支店数: ' + Object.keys(branchesData).length);
          
          // 本店関連の支店を検索
          let foundBranches = [];
          for (const bCode in branchesData) {
            const branch = branchesData[bCode];
            if (branch.name.includes('本店') || branch.name.includes('第一') || branch.name.includes('出張所')) {
              foundBranches.push(bCode + ': ' + branch.name);
            }
          }
          
          if (foundBranches.length > 0) {
            Logger.log('  本店関連支店:');
            foundBranches.forEach(branch => Logger.log('    ' + branch));
          }
        } catch (branchError) {
          Logger.log('  支店データ取得エラー: ' + branchError.toString());
        }
      }
    }
    
    // 最初の20件の金融機関名を表示
    Logger.log('\n=== 最初の20件の金融機関名 ===');
    let count = 0;
    for (const code in banksData) {
      if (count >= 20) break;
      Logger.log(code + ': ' + banksData[code].name);
      count++;
    }
    
  } catch (error) {
    Logger.log('デバッグエラー: ' + error.toString());
  }
}

/**
 * 強化された検索機能のテスト
 */
function testEnhancedSearch() {
  try {
    Logger.log('=== 強化検索機能テスト ===');
    
    const testCases = [
      { bankName: 'PayPay銀行', branchName: '本店営業部' },
      { bankName: '住信SBIネット銀行', branchName: 'レモン支店' },
      { bankName: 'auじぶん銀行', branchName: '本店営業部' },
      { bankName: 'PayPay', branchName: '本店' },
      { bankName: 'SBI銀行', branchName: '本店' },
      { bankName: 'AU銀行', branchName: '本店' }
    ];
    
    for (const testCase of testCases) {
      Logger.log(`\n--- テスト: ${testCase.bankName} - ${testCase.branchName} ---`);
      
      // 簡易検索をテスト
      const result = quickBankCodeSearch(testCase.bankName, testCase.branchName);
      
      if (result) {
        Logger.log(`✅ 成功: 金融機関コード=${result.bankCode}, 支店コード=${result.branchCode}`);
      } else {
        Logger.log('❌ 失敗: コードが見つかりませんでした');
      }
    }
    
  } catch (error) {
    Logger.log('強化検索テストエラー: ' + error.toString());
  }
}

/**
 * 特定の金融機関の支店一覧を確認
 * @param {string} bankCode - 金融機関コード
 */
function debugBankBranches(bankCode = '0005') {
  try {
    Logger.log('=== 金融機関コード ' + bankCode + ' の支店一覧 ===');
    
    const branchesUrl = `https://raw.githubusercontent.com/zengin-code/source-data/master/data/branches/${bankCode}.json`;
    const branchesResponse = UrlFetchApp.fetch(branchesUrl);
    const branchesData = JSON.parse(branchesResponse.getContentText());
    
    Logger.log('支店総数: ' + Object.keys(branchesData).length);
    
    // 最初の30件の支店を表示
    let count = 0;
    for (const bCode in branchesData) {
      if (count >= 30) break;
      const branch = branchesData[bCode];
      Logger.log(bCode + ': ' + branch.name);
      count++;
    }
    
    // 本店関連を検索
    Logger.log('\n=== 本店関連の支店 ===');
    for (const bCode in branchesData) {
      const branch = branchesData[bCode];
      if (branch.name.includes('本店') || branch.name.includes('第一') || branch.name.includes('出張所')) {
        Logger.log(bCode + ': ' + branch.name);
      }
    }
    
  } catch (error) {
    Logger.log('支店デバッグエラー: ' + error.toString());
  }
}

/**
 * 主要銀行の金融機関コードを検索
 */
function findMajorBankCodes() {
  try {
    Logger.log('=== 主要銀行コード検索 ===');
    
    const banksUrl = 'https://raw.githubusercontent.com/zengin-code/source-data/master/data/banks.json';
    const banksResponse = UrlFetchApp.fetch(banksUrl);
    const banksData = JSON.parse(banksResponse.getContentText());
    
    // 主要銀行の検索パターン
    const searchPatterns = [
      { keywords: ['三菱', 'UFJ', 'MUFG'], name: '三菱UFJ銀行' },
      { keywords: ['三井', '住友', 'SMBC'], name: '三井住友銀行' },
      { keywords: ['みずほ', 'Mizuho'], name: 'みずほ銀行' },
      { keywords: ['ゆうちょ', 'Post'], name: 'ゆうちょ銀行' },
      { keywords: ['滋賀'], name: '滋賀銀行' },
      { keywords: ['京都', '信用金庫'], name: '京都信用金庫' },
      { keywords: ['楽天'], name: '楽天銀行' }
    ];
    
    for (const pattern of searchPatterns) {
      Logger.log('\n--- ' + pattern.name + ' の検索 ---');
      let found = false;
      
      for (const code in banksData) {
        const bankName = banksData[code].name;
        for (const keyword of pattern.keywords) {
          if (bankName.includes(keyword)) {
            Logger.log('コード: ' + code + ' - 名前: ' + bankName);
            found = true;
            break;
          }
        }
        if (found) break;
      }
      
      if (!found) {
        Logger.log('見つかりませんでした');
      }
    }
    
  } catch (error) {
    Logger.log('主要銀行検索エラー: ' + error.toString());
  }
}

/**
 * 簡易的な金融機関コード検索（手動マッピング使用）
 */
function quickBankCodeSearch(bankName, branchName) {
  try {
    Logger.log('=== 簡易金融機関コード検索 ===');
    Logger.log('検索対象: ' + bankName + ' - ' + branchName);
    
    // 手動マッピング（主要銀行）- 拡張版
    const bankMapping = {
      '三菱UFJ': '0005',
      '三井住友': '0009', 
      'みずほ': '0001',
      'ゆうちょ': '9900',
      '滋賀': '0158',
      '京都信用金庫': '1150',
      '滋賀県信用組合': '2800',
      '京滋信用組合': '2801',
      '楽天': '0036',
      'ソニー': '0035',
      '新生': '0320',
      'イオン': '0040',
      'セブン': '0034',
      'PayPay': '0036', // 楽天銀行と同じコード
      'SBI': '0038',
      '住信SBI': '0038',
      'auじぶん': '0039',
      'auじぶん銀行': '0039'
    };
    
    // 金融機関コードを検索（柔軟な検索）
    let bankCode = findBankCodeFlexible(bankName, bankMapping);
    
    if (bankCode) {
      Logger.log('金融機関コード発見: ' + bankCode);
    }
    
    if (!bankCode) {
      Logger.log('金融機関コードが見つかりませんでした');
      return null;
    }
    
    // 支店データを取得
    try {
      const branchesUrl = `https://raw.githubusercontent.com/zengin-code/source-data/master/data/branches/${bankCode}.json`;
      const branchesResponse = UrlFetchApp.fetch(branchesUrl);
      const branchesData = JSON.parse(branchesResponse.getContentText());
      
      Logger.log('支店データ取得成功（' + Object.keys(branchesData).length + '件）');
      
      // 支店コードを検索
      for (const bCode in branchesData) {
        const branch = branchesData[bCode];
        if (branch.name.includes(branchName) || branchName.includes(branch.name)) {
          Logger.log('支店コード発見: ' + bCode + ' (' + branch.name + ')');
          return { bankCode, branchCode: bCode };
        }
      }
      
      Logger.log('支店コードが見つかりませんでした');
      Logger.log('利用可能な支店（最初の10件）:');
      let count = 0;
      for (const bCode in branchesData) {
        if (count >= 10) break;
        Logger.log('  ' + bCode + ': ' + branchesData[bCode].name);
        count++;
      }
      
    } catch (branchError) {
      Logger.log('支店データ取得エラー: ' + branchError.toString());
    }
    
    return null;
    
  } catch (error) {
    Logger.log('簡易検索エラー: ' + error.toString());
    return null;
  }
}

/**
 * 柔軟な金融機関コード検索
 * @param {string} bankName - 金融機関名
 * @param {Object} bankMapping - マッピング辞書
 * @returns {string} 金融機関コード
 */
function findBankCodeFlexible(bankName, bankMapping) {
  try {
    // 1. 直接マッチング
    for (const key in bankMapping) {
      if (bankName.includes(key)) {
        return bankMapping[key];
      }
    }
    
    // 2. 正規化後のマッチング
    const normalizedBankName = normalizeBankName(bankName);
    for (const key in bankMapping) {
      if (normalizedBankName.includes(key)) {
        return bankMapping[key];
      }
    }
    
    // 3. 大文字小文字を無視したマッチング
    const lowerBankName = bankName.toLowerCase();
    for (const key in bankMapping) {
      if (lowerBankName.includes(key.toLowerCase())) {
        return bankMapping[key];
      }
    }
    
    // 4. 半角全角変換後のマッチング
    const convertedBankName = convertFullWidthToHalfWidth(bankName);
    for (const key in bankMapping) {
      const convertedKey = convertFullWidthToHalfWidth(key);
      if (convertedBankName.includes(convertedKey)) {
        return bankMapping[key];
      }
    }
    
    // 5. 英語名・略称でのマッチング
    const englishMappings = {
      'paypay': '0036',
      'sbi': '0038',
      'au': '0039',
      'sony': '0035',
      'seven': '0034',
      'aeon': '0040',
      'rakuten': '0036'
    };
    
    const lowerBankNameForEnglish = bankName.toLowerCase();
    for (const englishKey in englishMappings) {
      if (lowerBankNameForEnglish.includes(englishKey)) {
        return englishMappings[englishKey];
      }
    }
    
    return '';
    
  } catch (error) {
    Logger.log('柔軟検索エラー: ' + error.toString());
    return '';
  }
}

/**
 * 全角文字を半角文字に変換
 * @param {string} text - 変換対象文字列
 * @returns {string} 変換後の文字列
 */
function convertFullWidthToHalfWidth(text) {
  return text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    })
    .replace(/[ー－]/g, '-')
    .replace(/[　\s]/g, '');
}

/**
 * 受取人名を半角カタカナに変換
 * @param {string} name - 受取人名
 * @returns {string} 半角カタカナに変換された名前
 */
function convertToHalfWidthKatakana(name) {
  if (!name) return name;
  
  // 全角カタカナ → 半角カタカナ マッピング
  const katakanaMap = {
    'ア': 'ｱ', 'イ': 'ｲ', 'ウ': 'ｳ', 'エ': 'ｴ', 'オ': 'ｵ',
    'カ': 'ｶ', 'キ': 'ｷ', 'ク': 'ｸ', 'ケ': 'ｹ', 'コ': 'ｺ',
    'サ': 'ｻ', 'シ': 'ｼ', 'ス': 'ｽ', 'セ': 'ｾ', 'ソ': 'ｿ',
    'タ': 'ﾀ', 'チ': 'ﾁ', 'ツ': 'ﾂ', 'テ': 'ﾃ', 'ト': 'ﾄ',
    'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ', 'ノ': 'ﾉ',
    'ハ': 'ﾊ', 'ヒ': 'ﾋ', 'フ': 'ﾌ', 'ヘ': 'ﾍ', 'ホ': 'ﾎ',
    'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ', 'モ': 'ﾓ',
    'ヤ': 'ﾔ', 'ユ': 'ﾕ', 'ヨ': 'ﾖ',
    'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ', 'レ': 'ﾚ', 'ロ': 'ﾛ',
    'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ',
    'ァ': 'ｧ', 'ィ': 'ｨ', 'ゥ': 'ｩ', 'ェ': 'ｪ', 'ォ': 'ｫ',
    'ャ': 'ｬ', 'ュ': 'ｭ', 'ョ': 'ｮ',
    'ッ': 'ｯ', 'ー': 'ｰ'
  };
  
  // ひらがな → 半角カタカナ マッピング
  const hiraganaMap = {
    'あ': 'ｱ', 'い': 'ｲ', 'う': 'ｳ', 'え': 'ｴ', 'お': 'ｵ',
    'か': 'ｶ', 'き': 'ｷ', 'く': 'ｸ', 'け': 'ｹ', 'こ': 'ｺ',
    'さ': 'ｻ', 'し': 'ｼ', 'す': 'ｽ', 'せ': 'ｾ', 'そ': 'ｿ',
    'た': 'ﾀ', 'ち': 'ﾁ', 'つ': 'ﾂ', 'て': 'ﾃ', 'と': 'ﾄ',
    'な': 'ﾅ', 'に': 'ﾆ', 'ぬ': 'ﾇ', 'ね': 'ﾈ', 'の': 'ﾉ',
    'は': 'ﾊ', 'ひ': 'ﾋ', 'ふ': 'ﾌ', 'へ': 'ﾍ', 'ほ': 'ﾎ',
    'ま': 'ﾏ', 'み': 'ﾐ', 'む': 'ﾑ', 'め': 'ﾒ', 'も': 'ﾓ',
    'や': 'ﾔ', 'ゆ': 'ﾕ', 'よ': 'ﾖ',
    'ら': 'ﾗ', 'り': 'ﾘ', 'る': 'ﾙ', 'れ': 'ﾚ', 'ろ': 'ﾛ',
    'わ': 'ﾜ', 'を': 'ｦ', 'ん': 'ﾝ',
    'ぁ': 'ｧ', 'ぃ': 'ｨ', 'ぅ': 'ｩ', 'ぇ': 'ｪ', 'ぉ': 'ｫ',
    'ゃ': 'ｬ', 'ゅ': 'ｭ', 'ょ': 'ｮ',
    'っ': 'ｯ'
  };
  
  let result = name;
  
  // 全角カタカナを変換
  for (const [full, half] of Object.entries(katakanaMap)) {
    result = result.replace(new RegExp(full, 'g'), half);
  }
  
  // ひらがなを変換
  for (const [hira, half] of Object.entries(hiraganaMap)) {
    result = result.replace(new RegExp(hira, 'g'), half);
  }
  
  return result;
}

/**
 * 受取人名を半角カタカナに変換（正しい版）
 * @param {string} name - 受取人名
 * @returns {string} 半角カタカナに変換された名前
 */
function convertToHalfWidthKatakanaCorrect(name) {
  if (!name) return name;
  
  // 全角カタカナを半角カタカナに変換
  let result = name.replace(/[ァ-ヶ]/g, function(s) {
    const code = s.charCodeAt(0);
    if (code >= 0x30A1 && code <= 0x30F6) {
      // 全角カタカナを半角カタカナに変換
      return String.fromCharCode(code - 0x30A1 + 0xFF66);
    }
    return s;
  });
  
  // ひらがなを半角カタカナに変換
  result = result.replace(/[ぁ-ゖ]/g, function(s) {
    const code = s.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) {
      // ひらがなを半角カタカナに変換
      return String.fromCharCode(code - 0x3041 + 0xFF66);
    }
    return s;
  });
  
  return result;
}

/**
 * 受取人名を半角カタカナに変換（マッピング版）
 * @param {string} name - 受取人名
 * @returns {string} 半角カタカナに変換された名前
 */
function convertToHalfWidthKatakanaMapping(name) {
  if (!name) return name;
  
  // 全角カタカナ → 半角カタカナ マッピング
  const katakanaMap = {
    'ア': 'ｱ', 'イ': 'ｲ', 'ウ': 'ｳ', 'エ': 'ｴ', 'オ': 'ｵ',
    'カ': 'ｶ', 'キ': 'ｷ', 'ク': 'ｸ', 'ケ': 'ｹ', 'コ': 'ｺ',
    'サ': 'ｻ', 'シ': 'ｼ', 'ス': 'ｽ', 'セ': 'ｾ', 'ソ': 'ｿ',
    'タ': 'ﾀ', 'チ': 'ﾁ', 'ツ': 'ﾂ', 'テ': 'ﾃ', 'ト': 'ﾄ',
    'ナ': 'ﾅ', 'ニ': 'ﾆ', 'ヌ': 'ﾇ', 'ネ': 'ﾈ', 'ノ': 'ﾉ',
    'ハ': 'ﾊ', 'ヒ': 'ﾋ', 'フ': 'ﾌ', 'ヘ': 'ﾍ', 'ホ': 'ﾎ',
    'マ': 'ﾏ', 'ミ': 'ﾐ', 'ム': 'ﾑ', 'メ': 'ﾒ', 'モ': 'ﾓ',
    'ヤ': 'ﾔ', 'ユ': 'ﾕ', 'ヨ': 'ﾖ',
    'ラ': 'ﾗ', 'リ': 'ﾘ', 'ル': 'ﾙ', 'レ': 'ﾚ', 'ロ': 'ﾛ',
    'ワ': 'ﾜ', 'ヲ': 'ｦ', 'ン': 'ﾝ',
    'ァ': 'ｧ', 'ィ': 'ｨ', 'ゥ': 'ｩ', 'ェ': 'ｪ', 'ォ': 'ｫ',
    'ャ': 'ｬ', 'ュ': 'ｭ', 'ョ': 'ｮ',
    'ッ': 'ｯ', 'ー': 'ｰ'
  };
  
  // ひらがな → 半角カタカナ マッピング
  const hiraganaMap = {
    'あ': 'ｱ', 'い': 'ｲ', 'う': 'ｳ', 'え': 'ｴ', 'お': 'ｵ',
    'か': 'ｶ', 'き': 'ｷ', 'く': 'ｸ', 'け': 'ｹ', 'こ': 'ｺ',
    'さ': 'ｻ', 'し': 'ｼ', 'す': 'ｽ', 'せ': 'ｾ', 'そ': 'ｿ',
    'た': 'ﾀ', 'ち': 'ﾁ', 'つ': 'ﾂ', 'て': 'ﾃ', 'と': 'ﾄ',
    'な': 'ﾅ', 'に': 'ﾆ', 'ぬ': 'ﾇ', 'ね': 'ﾈ', 'の': 'ﾉ',
    'は': 'ﾊ', 'ひ': 'ﾋ', 'ふ': 'ﾌ', 'へ': 'ﾍ', 'ほ': 'ﾎ',
    'ま': 'ﾏ', 'み': 'ﾐ', 'む': 'ﾑ', 'め': 'ﾒ', 'も': 'ﾓ',
    'や': 'ﾔ', 'ゆ': 'ﾕ', 'よ': 'ﾖ',
    'ら': 'ﾗ', 'り': 'ﾘ', 'る': 'ﾙ', 'れ': 'ﾚ', 'ろ': 'ﾛ',
    'わ': 'ﾜ', 'を': 'ｦ', 'ん': 'ﾝ',
    'ぁ': 'ｧ', 'ぃ': 'ｨ', 'ぅ': 'ｩ', 'ぇ': 'ｪ', 'ぉ': 'ｫ',
    'ゃ': 'ｬ', 'ゅ': 'ｭ', 'ょ': 'ｮ',
    'っ': 'ｯ'
  };
  
  let result = name;
  
  // 全角カタカナを変換
  for (const [full, half] of Object.entries(katakanaMap)) {
    result = result.replace(new RegExp(full, 'g'), half);
  }
  
  // ひらがなを変換
  for (const [hira, half] of Object.entries(hiraganaMap)) {
    result = result.replace(new RegExp(hira, 'g'), half);
  }
  
  return result;
}

/**
 * 請求書データの必須項目を検証
 * @param {Object} invoiceData - 請求書データ
 * @returns {Array} 不足している項目の配列
 */
function validateInvoiceData(invoiceData) {
  const requiredFields = [
    'companyName',
    'bankName', 
    'branchName',
    'accountType',
    'accountNumber',
    'recipientName',
    'amount',
    'deadline'
  ];
  
  const missingFields = [];
  
  for (const field of requiredFields) {
    if (!invoiceData[field] || invoiceData[field] === '不明' || invoiceData[field].trim() === '') {
      const fieldNames = {
        'companyName': '発行会社名',
        'bankName': '振込先銀行',
        'branchName': '振込先支店',
        'accountType': '預金種目',
        'accountNumber': '口座番号',
        'recipientName': '受取人名',
        'amount': '振込金額',
        'deadline': '振込期限'
      };
      missingFields.push(fieldNames[field]);
    }
  }
  
  return missingFields;
}

/**
 * 統一金融機関番号・統一店舗番号を取得
 * @param {string} bankName - 銀行名
 * @param {string} branchName - 支店名
 * @returns {Object} 統一コード {unifiedBankCode, unifiedBranchCode}
 */
function getUnifiedBankCodes(bankName, branchName) {
  try {
    Logger.log('統一金融機関番号・統一店舗番号を取得中...');
    
    // 既存の金融機関コード検索を使用
    let bankCodes = getBankAndBranchCodes(bankName, branchName);
    
    // 通常検索が失敗した場合は簡易検索を試行
    if (!bankCodes) {
      bankCodes = quickBankCodeSearch(bankName, branchName);
    }
    
    if (bankCodes) {
      // 金融機関コードと支店コードを統一コードとして使用
      return {
        unifiedBankCode: bankCodes.bankCode,
        unifiedBranchCode: bankCodes.branchCode
      };
    }
    
    return null;
    
  } catch (error) {
    Logger.log('統一金融機関番号取得エラー: ' + error.toString());
    return null;
  }
}

/**
 * ファイルを処理不可フォルダに移動
 * @param {File} file - 移動するファイル
 */
function moveFileToProcessedFolder(file) {
  try {
    Logger.log('ファイルを処理不可フォルダに移動中: ' + file.getName());
    
    const processedFolder = DriveApp.getFolderById(PROCESSED_FOLDER_ID);
    file.moveTo(processedFolder);
    
    Logger.log('ファイル移動完了: ' + file.getName());
    
  } catch (error) {
    Logger.log('ファイル移動エラー: ' + error.toString());
  }
}

/**
 * 振込期限をチェック
 * @param {string} deadline - 振込期限
 * @returns {Object} 期限チェック結果 {isUrgent, daysLeft}
 */
function checkPaymentDeadline(deadline) {
  try {
    Logger.log('振込期限チェック中: ' + deadline);
    
    // 現在の日付
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // 月末日を取得
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    // 期限日をパース
    let deadlineDate = null;
    
    // 様々な日付形式に対応
    const datePatterns = [
      /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, // YYYY/MM/DD or YYYY-MM-DD
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/, // MM/DD/YYYY or MM-DD-YYYY
      /(\d{1,2})月(\d{1,2})日/, // MM月DD日
      /(\d{1,2})\/(\d{1,2})/ // MM/DD
    ];
    
    for (const pattern of datePatterns) {
      const match = deadline.match(pattern);
      if (match) {
        if (match[3]) {
          // YYYY/MM/DD形式
          if (match[1].length === 4) {
            deadlineDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
          } else {
            deadlineDate = new Date(parseInt(match[3]), parseInt(match[1]) - 1, parseInt(match[2]));
          }
        } else {
          // MM/DD形式（今年の日付として処理）
          deadlineDate = new Date(currentYear, parseInt(match[1]) - 1, parseInt(match[2]));
        }
        break;
      }
    }
    
    if (!deadlineDate) {
      Logger.log('期限日のパースに失敗しました');
      return { isUrgent: false, daysLeft: null };
    }
    
    // 残り日数を計算
    const timeDiff = deadlineDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    // 月末に近い場合は緊急ではない
    const isEndOfMonth = (today.getDate() >= lastDayOfMonth - 3) && 
                         (deadlineDate.getDate() >= lastDayOfMonth - 3);
    
    // 1週間以内かつ月末でない場合は緊急
    const isUrgent = (daysLeft <= 7 && daysLeft >= 0) && !isEndOfMonth;
    
    Logger.log(`期限チェック結果: 残り${daysLeft}日, 緊急: ${isUrgent}`);
    
    return { isUrgent, daysLeft };
    
  } catch (error) {
    Logger.log('振込期限チェックエラー: ' + error.toString());
    return { isUrgent: false, daysLeft: null };
  }
}

/**
 * CSVファイルを確認・作成
 * @returns {File} CSVファイル
 */
function ensureMonthlyCSVExists() {
  try {
    Logger.log('月末振込用CSVファイルを確認中...');
    
    const csvFolder = DriveApp.getFolderById(CSV_FOLDER_ID);
    const today = new Date();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    
    const csvFileName = `${month}月振込用.csv`;
    
    // 既存のCSVファイルを検索
    const files = csvFolder.getFilesByName(csvFileName);
    
    if (files.hasNext()) {
      const csvFile = files.next();
      Logger.log('既存のCSVファイルが見つかりました: ' + csvFileName);
      
      // 既存ファイルにヘッダー行がある場合は削除
      let csvContent = csvFile.getBlob().getDataAsString('UTF-8');
      
      // BOMを除去
      if (csvContent.startsWith('\uFEFF')) {
        csvContent = csvContent.substring(1);
      }
      
      const lines = csvContent.split('\n');
      
      // ヘッダー行をチェックして削除
      if (lines.length > 0 && lines[0].includes('金融機関コード')) {
        Logger.log('ヘッダー行を削除中...');
        const dataLines = lines.slice(1).filter(line => line.trim() !== '');
        const newContent = dataLines.join('\n');
        
        // UTF-8 BOM付きで保存
        const bom = Utilities.newBlob('\uFEFF', 'text/csv');
        const finalContent = bom.getDataAsString() + newContent;
        csvFile.setContent(finalContent);
        Logger.log('ヘッダー行を削除しました');
      }
      
      return csvFile;
    } else {
      // 新しいCSVファイルを作成（ヘッダーなし、UTF-8 BOM付き）
      Logger.log('新しいCSVファイルを作成中: ' + csvFileName);
      
      // UTF-8 BOM付きで空のCSVファイルを作成
      const csvContent = '';
      const csvFile = csvFolder.createFile(csvFileName, csvContent, MimeType.PLAIN_TEXT);
      
      // UTF-8 BOMを設定
      const blob = csvFile.getBlob();
      const bom = Utilities.newBlob('\uFEFF', 'text/csv', csvFileName);
      csvFile.setContent(bom.getDataAsString());
      
      Logger.log('CSVファイル作成完了: ' + csvFileName);
      return csvFile;
    }
    
  } catch (error) {
    Logger.log('CSVファイル確認・作成エラー: ' + error.toString());
    return null;
  }
}

/**
 * CSVに重複する会社があるかチェック
 * @param {string} companyName - 会社名
 * @returns {boolean} 重複があるかどうか
 */
function checkDuplicateCompanyInCSV(companyName) {
  try {
    Logger.log('CSV内の重複会社をチェック中: ' + companyName);
    
    const csvFile = ensureMonthlyCSVExists();
    if (!csvFile) {
      Logger.log('CSVファイルの取得に失敗しました');
      return false;
    }
    
    let csvContent = csvFile.getBlob().getDataAsString('UTF-8');
    
    // BOMを除去
    if (csvContent.startsWith('\uFEFF')) {
      csvContent = csvContent.substring(1);
    }
    
    const lines = csvContent.split('\n');
    
    // ヘッダー行をスキップしてチェック（最初の行が日本語の場合はヘッダー）
    let startIndex = 0;
    if (lines.length > 0 && lines[0].includes('金融機関コード')) {
      startIndex = 1;
    }
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        const columns = line.split(',');
        if (columns.length >= 5) {
          const recipientName = columns[4]; // 受取人名
          if (recipientName && recipientName.includes(companyName)) {
            Logger.log('重複会社を発見: ' + companyName);
            return true;
          }
        }
      }
    }
    
    Logger.log('重複会社なし: ' + companyName);
    return false;
    
  } catch (error) {
    Logger.log('重複チェックエラー: ' + error.toString());
    return false;
  }
}

/**
 * CSVに請求書データを追加
 * @param {Object} invoiceData - 請求書データ
 * @returns {Object} 処理結果 {success, reason}
 */
function addToCSV(invoiceData) {
  try {
    Logger.log('CSVに請求書データを追加中...');
    
    const csvFile = ensureMonthlyCSVExists();
    if (!csvFile) {
      return { success: false, reason: 'CSVファイルの取得に失敗' };
    }
    
    // 重複チェック
    if (checkDuplicateCompanyInCSV(invoiceData.companyName)) {
      return { success: false, reason: '重複会社が存在' };
    }
    
    // 振込期限チェック
    const deadlineCheck = checkPaymentDeadline(invoiceData.deadline);
    if (deadlineCheck.isUrgent) {
      return { success: false, reason: '緊急振込期限' };
    }
    
    // CSV行を作成（金融機関コード,支店コード,預金種目,口座番号,受取人名,振込金額,,）
    const csvRow = [
      invoiceData.unifiedBankCode,
      invoiceData.unifiedBranchCode,
      invoiceData.accountTypeCode,
      invoiceData.accountNumber || '', // 口座番号
      invoiceData.recipientName, // 受取人名（Vertex AIが半角カタカナで抽出済み）
      invoiceData.amount.replace(/[¥,]/g, ''), // カンマと¥を除去
      '', // 空欄
      ''  // 空欄
    ].join(',') + '\n';
    
    // CSVファイルに追加（UTF-8 BOM付き）
    let currentContent = csvFile.getBlob().getDataAsString('UTF-8');
    
    // BOMが存在しない場合は追加
    if (!currentContent.startsWith('\uFEFF')) {
      currentContent = '\uFEFF' + currentContent;
    }
    
    const newContent = currentContent + csvRow;
    
    // UTF-8 BOM付きで保存
    const bom = Utilities.newBlob('\uFEFF', 'text/csv');
    const finalContent = bom.getDataAsString() + newContent.replace(/^\uFEFF/, '');
    csvFile.setContent(finalContent);
    
    Logger.log('CSVにデータを追加完了');
    return { success: true, reason: '追加完了' };
    
  } catch (error) {
    Logger.log('CSV追加エラー: ' + error.toString());
    return { success: false, reason: 'CSV追加エラー' };
  }
}

/**
 * CSV処理のメイン関数
 * @param {Object} invoiceData - 請求書データ
 * @param {File} file - ファイル
 * @returns {Object} 処理結果
 */
function processCSV(invoiceData, file) {
  try {
    Logger.log('CSV処理開始...');
    
    // 振込期限チェック
    const deadlineCheck = checkPaymentDeadline(invoiceData.deadline);
    if (deadlineCheck.isUrgent) {
      Logger.log('緊急振込期限のため、対話承認型通知を送信');
      sendUrgentPaymentNotification(
        invoiceData.companyName,
        deadlineCheck.daysLeft,
        file.getName(),
        file.getUrl()
      );
      return { success: false, reason: '緊急振込期限 - 対話承認待ち' };
    }
    
    // 重複チェック
    if (checkDuplicateCompanyInCSV(invoiceData.companyName)) {
      Logger.log('重複会社のため、対話承認型通知を送信');
      sendDuplicateCompanyNotification(
        invoiceData.companyName,
        file.getName(),
        file.getUrl()
      );
      return { success: false, reason: '重複会社 - 対話承認待ち' };
    }
    
    // CSVに追加
    const csvResult = addToCSV(invoiceData);
    return csvResult;
    
  } catch (error) {
    Logger.log('CSV処理エラー: ' + error.toString());
    return { success: false, reason: 'CSV処理エラー' };
  }
}

/**
 * 全ての結果をまとめて表示
 * @param {Array} results - 処理結果の配列
 */
function displayAllResults(results) {
  try {
    Logger.log('\n' + '='.repeat(60));
    Logger.log('=== 全処理結果 ===');
    Logger.log('='.repeat(60));
    
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    
    Logger.log(`処理件数: ${results.length}件`);
    Logger.log(`成功: ${successfulResults.length}件`);
    Logger.log(`失敗: ${failedResults.length}件`);
    
    if (successfulResults.length > 0) {
      Logger.log('\n--- ✅ 成功した結果 ---');
      successfulResults.forEach((result, index) => {
        Logger.log(`${index + 1}. ${result.bankName} - ${result.branchName}`);
        Logger.log(`   金融機関コード: ${result.bankCode}`);
        Logger.log(`   支店コード: ${result.branchCode}`);
        Logger.log('');
      });
    }
    
    if (failedResults.length > 0) {
      Logger.log('\n--- ❌ 失敗した結果 ---');
      failedResults.forEach((result, index) => {
        Logger.log(`${index + 1}. ${result.bankName} - ${result.branchName}`);
        Logger.log('   ※ コードが見つかりませんでした');
        Logger.log('');
      });
    }
    
    // CSV形式での結果表示
    Logger.log('\n--- 📊 CSV形式での結果 ---');
    Logger.log('金融機関名,支店名,金融機関コード,支店コード,処理結果');
    results.forEach(result => {
      const status = result.success ? '成功' : '失敗';
      const bankCode = result.bankCode || '';
      const branchCode = result.branchCode || '';
      Logger.log(`"${result.bankName}","${result.branchName}","${bankCode}","${branchCode}","${status}"`);
    });
    
    Logger.log('\n' + '='.repeat(60));
    
  } catch (error) {
    Logger.log('結果表示エラー: ' + error.toString());
  }
}

/**
 * フォルダの詳細診断
 * @param {string} folderId - フォルダID
 */
function diagnoseFolder(folderId) {
  try {
    Logger.log('=== フォルダ診断開始 ===');
    const folder = DriveApp.getFolderById(folderId);
    
    Logger.log('フォルダID: ' + folderId);
    Logger.log('フォルダ名: ' + folder.getName());
    Logger.log('作成日: ' + folder.getDateCreated());
    Logger.log('最終更新日: ' + folder.getLastUpdated());
    Logger.log('所有者: ' + folder.getOwner().getName());
    Logger.log('URL: ' + folder.getUrl());
    
    // フォルダ内のファイル数を取得
    const files = folder.getFiles();
    let fileCount = 0;
    while (files.hasNext()) {
      files.next();
      fileCount++;
    }
    Logger.log('フォルダ内ファイル数: ' + fileCount + ' 個');
    
    Logger.log('=== フォルダ診断終了 ===');
    
  } catch (error) {
    Logger.log('フォルダ診断エラー: ' + error.toString());
  }
}

/**
 * フォルダ内のファイル一覧を取得
 * @param {string} folderId - フォルダID
 * @returns {Array} ファイル配列
 */
function getFilesInFolder(folderId) {
  try {
    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const fileList = [];
    
    while (files.hasNext()) {
      const file = files.next();
      fileList.push(file);
    }
    
    Logger.log('取得されたファイル一覧:');
    fileList.forEach((file, index) => {
      Logger.log((index + 1) + '. ' + file.getName() + ' (' + file.getSize() + ' bytes)');
    });
    
    return fileList;
    
  } catch (error) {
    Logger.log('ファイル一覧取得エラー: ' + error.toString());
    return null;
  }
}

/**
 * 個別ファイルを処理
 * @param {File} file - Google Driveファイル
 */
function processFile(file) {
  try {
    Logger.log('ファイル名: ' + file.getName());
    Logger.log('ファイルサイズ: ' + file.getSize() + ' bytes');
    Logger.log('MIMEタイプ: ' + file.getMimeType());
    
    // ファイル内容を取得
    const fileContent = getFileContentFromFile(file);
    if (fileContent === null) {
      Logger.log('ファイルの読み取りに失敗しました');
      return;
    }
    
    // 空ファイルの場合の処理
    if (fileContent === '') {
      Logger.log('ファイルが空です。スキップします。');
      return;
    }
    
    Logger.log('ファイル内容を取得しました（長さ: ' + fileContent.length + '文字）');
    Logger.log('ファイル内容の最初の200文字: ' + fileContent.substring(0, 200));
    
    // 複数の金融機関・支店を抽出
    let allBankInfos = [];
    
    // まずVertex AIで抽出を試行
    const analysisResult = analyzeWithVertexAI(fileContent);
    if (analysisResult) {
      const aiBankInfos = extractAllBankInfosFromAI(analysisResult);
      allBankInfos = allBankInfos.concat(aiBankInfos);
    }
    
    // パターンマッチングでも抽出
    const patternBankInfos = extractAllBankInfos(fileContent);
    allBankInfos = allBankInfos.concat(patternBankInfos);
    
    // 重複を除去
    allBankInfos = removeDuplicateBankInfos(allBankInfos);
    
    if (!allBankInfos || allBankInfos.length === 0) {
      Logger.log('金融機関情報の抽出に失敗しました');
      return;
    }
    
    Logger.log('抽出された金融機関情報数: ' + allBankInfos.length);
    
    // 各金融機関・支店のコードを取得
    const results = [];
    for (let i = 0; i < allBankInfos.length; i++) {
      const bankInfo = allBankInfos[i];
      Logger.log(`\n--- 処理中 (${i + 1}/${allBankInfos.length}) ---`);
      Logger.log('金融機関名: ' + bankInfo.bankName);
      Logger.log('支店名: ' + bankInfo.branchName);
      
      // zengin-codeデータから対応するコードを取得
      let codes = getBankAndBranchCodes(bankInfo.bankName, bankInfo.branchName);
      
      // 通常の検索が失敗した場合は簡易検索を試行
      if (!codes) {
        Logger.log('通常検索が失敗したため、簡易検索を試行します');
        codes = quickBankCodeSearch(bankInfo.bankName, bankInfo.branchName);
      }
      
      const result = {
        bankName: bankInfo.bankName,
        branchName: bankInfo.branchName,
        bankCode: codes ? codes.bankCode : null,
        branchCode: codes ? codes.branchCode : null,
        success: !!codes
      };
      
      results.push(result);
      
      if (codes) {
        Logger.log('✅ 成功: 金融機関コード=' + codes.bankCode + ', 支店コード=' + codes.branchCode);
      } else {
        Logger.log('❌ 失敗: コードが見つかりませんでした');
      }
    }
    
    // 結果をまとめて表示
    displayAllResults(results);
    
  } catch (error) {
    Logger.log('ファイル処理エラー: ' + error.toString());
    throw error;
  }
}

/**
 * ファイルオブジェクトから内容を取得
 * @param {File} file - Google Driveファイル
 * @returns {string} ファイル内容
 */
function getFileContentFromFile(file) {
  try {
    const mimeType = file.getMimeType();
    Logger.log('ファイル形式詳細: ' + mimeType);
    
    // ファイルサイズが0の場合
    if (file.getSize() === 0) {
      Logger.log('警告: ファイルサイズが0バイトです');
      return '';
    }
    
    // 各種ファイル形式に対応
    if (mimeType.includes('text/') || 
        mimeType.includes('application/json') ||
        mimeType.includes('application/xml') ||
        mimeType.includes('application/csv') ||
        mimeType === 'application/vnd.google-apps.document') {
      
      if (mimeType === 'application/vnd.google-apps.document') {
        // Google Docsファイルの場合
        Logger.log('Google Docsファイルを検出');
        return convertGoogleDocToString(file);
      } else {
        // 通常のテキストファイル
        Logger.log('テキストファイルとして読み取り');
        return file.getBlob().getDataAsString('UTF-8');
      }
    } else if (mimeType.includes('application/vnd.openxmlformats') || 
               mimeType.includes('application/vnd.ms-excel')) {
      
      Logger.log('バイナリファイル形式を検出: ' + mimeType);
      Logger.log('この形式のファイルは直接読み取れません');
      return null;
    } else if (mimeType.includes('application/pdf')) {
      
      Logger.log('PDFファイル形式を検出: ' + mimeType);
      Logger.log('PDFファイルをVertex AIで直接処理します');
      // PDFファイルはVertex AIに直接送信するため、ここではnullを返す
      // 実際の処理はanalyzeInvoiceWithVertexAIで行う
      return 'PDF_FILE';
    } else {
      // その他の形式はUTF-8で試行
      Logger.log('その他のファイル形式、UTF-8で読み取り試行');
      try {
        return file.getBlob().getDataAsString('UTF-8');
      } catch (encodingError) {
        Logger.log('UTF-8読み取り失敗: ' + encodingError.toString());
        return null;
      }
    }
  } catch (error) {
    Logger.log('ファイル内容取得エラー: ' + error.toString());
    return null;
  }
}

/**
 * サンプルデータでテスト実行
 */
function runSampleTest() {
  try {
    Logger.log('=== サンプルテスト開始 ===');
    
    // サンプルの請求書データ
    const sampleContent = `
請求書
請求書番号: INV-2024-001
発行日: 2024年1月15日

請求先:
株式会社サンプル
〒100-0001 東京都千代田区千代田1-1-1

振込先:
金融機関名: 三菱UFJ銀行
支店名: 本店
口座種別: 普通
口座番号: 1234567
口座名義: 株式会社サンプル

請求内容:
商品A x 10個 @ 1,000円 = 10,000円
商品B x 5個 @ 2,000円 = 10,000円
小計: 20,000円
消費税(10%): 2,000円
合計: 22,000円

支払期限: 2024年2月15日
    `;
    
    Logger.log('サンプルデータで分析を実行します');
    Logger.log('サンプル内容: ' + sampleContent);
    
    // Vertex AIで分析
    const analysisResult = analyzeWithVertexAI(sampleContent);
    if (!analysisResult) {
      Logger.log('サンプルデータの分析に失敗しました');
      return;
    }
    
    // 金融機関情報を抽出
    const bankInfo = extractBankInfo(analysisResult);
    if (!bankInfo) {
      Logger.log('サンプルデータから金融機関情報の抽出に失敗しました');
      return;
    }
    
    Logger.log('抽出された金融機関情報: ' + JSON.stringify(bankInfo));
    
    // コードを取得
    const codes = getBankAndBranchCodes(bankInfo.bankName, bankInfo.branchName);
    if (codes) {
      Logger.log('=== サンプルテスト結果 ===');
      Logger.log('金融機関名: ' + bankInfo.bankName);
      Logger.log('支店名: ' + bankInfo.branchName);
      Logger.log('金融機関コード: ' + codes.bankCode);
      Logger.log('支店コード: ' + codes.branchCode);
    } else {
      Logger.log('サンプルデータでコードが見つかりませんでした');
    }
    
  } catch (error) {
    Logger.log('サンプルテストエラー: ' + error.toString());
  }
}

/**
 * 請求書処理システムのテスト
 */
function testInvoiceProcessingSystem() {
  try {
    Logger.log('=== 請求書処理システムテスト ===');
    
    // サンプル請求書データ
    const sampleInvoiceData = {
      companyName: 'テスト株式会社',
      bankName: '三菱UFJ銀行',
      branchName: '本店',
      accountType: '普通',
      accountTypeCode: 1,
      recipientName: 'テスト株式会社',
      amount: '100000',
      deadline: '2024/10/31'
    };
    
    Logger.log('テストデータ: ' + JSON.stringify(sampleInvoiceData));
    
    // 1. 必須項目検証テスト
    const missingFields = validateInvoiceData(sampleInvoiceData);
    Logger.log('必須項目検証結果: ' + (missingFields.length === 0 ? 'OK' : 'NG - ' + missingFields.join(', ')));
    
    // 2. 統一金融機関番号取得テスト
    const unifiedCodes = getUnifiedBankCodes(sampleInvoiceData.bankName, sampleInvoiceData.branchName);
    Logger.log('統一金融機関番号取得結果: ' + (unifiedCodes ? 'OK' : 'NG'));
    if (unifiedCodes) {
      Logger.log('統一金融機関番号: ' + unifiedCodes.unifiedBankCode);
      Logger.log('統一店舗番号: ' + unifiedCodes.unifiedBranchCode);
    }
    
    // 3. 振込期限チェックテスト
    const deadlineCheck = checkPaymentDeadline(sampleInvoiceData.deadline);
    Logger.log('振込期限チェック結果: 緊急=' + deadlineCheck.isUrgent + ', 残り日数=' + deadlineCheck.daysLeft);
    
    // 4. CSVファイル確認テスト
    const csvFile = ensureMonthlyCSVExists();
    Logger.log('CSVファイル確認結果: ' + (csvFile ? 'OK' : 'NG'));
    
    // 5. 重複チェックテスト
    const duplicateCheck = checkDuplicateCompanyInCSV(sampleInvoiceData.companyName);
    Logger.log('重複チェック結果: ' + (duplicateCheck ? '重複あり' : '重複なし'));
    
    // 6. Slack通知テスト（実際には送信しない）
    Logger.log('Slack通知テスト: スキップ（実際の送信は行いません）');
    
    Logger.log('=== テスト完了 ===');
    
  } catch (error) {
    Logger.log('テストエラー: ' + error.toString());
  }
}

/**
 * Slack認証テスト
 */
function testSlackAuth() {
  try {
    Logger.log('=== Slack認証テスト ===');
    
    const authUrl = 'https://slack.com/api/auth.test';
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + SLACK_BOT_TOKEN,
        'Content-Type': 'application/json'
      }
    };
    
    const response = UrlFetchApp.fetch(authUrl, options);
    const responseData = JSON.parse(response.getContentText());
    
    Logger.log('Slack認証レスポンス: ' + JSON.stringify(responseData));
    
    if (responseData.ok) {
      Logger.log('✅ Slack認証成功');
      Logger.log('チーム名: ' + responseData.team);
      Logger.log('ユーザー名: ' + responseData.user);
    } else {
      Logger.log('❌ Slack認証失敗: ' + responseData.error);
    }
    
  } catch (error) {
    Logger.log('Slack認証テストエラー: ' + error.toString());
  }
}

/**
 * Slack通知テスト
 */
function testSlackNotification() {
  try {
    Logger.log('=== Slack通知テスト ===');
    
    // 基本的な通知テスト
    const testMessage = 'テスト通知: 請求書処理システムのテスト実行中';
    const success = sendSlackNotification(testMessage);
    
    Logger.log('Slack通知テスト結果: ' + (success ? '成功' : '失敗'));
    
    // 空のメッセージテスト
    Logger.log('\n--- 空メッセージテスト ---');
    const emptyMessageSuccess = sendSlackNotification('');
    Logger.log('空メッセージテスト結果: ' + (emptyMessageSuccess ? '成功' : '失敗'));
    
    // undefinedメッセージテスト
    Logger.log('\n--- undefinedメッセージテスト ---');
    const undefinedMessageSuccess = sendSlackNotification(undefined);
    Logger.log('undefinedメッセージテスト結果: ' + (undefinedMessageSuccess ? '成功' : '失敗'));
    
  } catch (error) {
    Logger.log('Slack通知テストエラー: ' + error.toString());
  }
}

/**
 * 半角カタカナ変換テスト
 */
function testKatakanaConversion() {
  try {
    Logger.log('=== 半角カタカナ変換テスト ===');
    
    const testNames = [
      'ニホン サンプル',
      'ニホンサンプル',
      'にほん さんぷる',
      '日本 サンプル',
      'ニホン・サンプル',
      'ニホン　サンプル', // 全角スペース
      'ニホンサンプル株式会社',
      'アリガトウ',
      'ありがとう',
      'コンニチハ',
      'こんにちは',
      'ｶ) ﾆﾎﾝｻﾝﾌﾟﾙ', // 記号付き半角カタカナ
      'ｷ) ﾃｽﾄｶﾞｲｼｬ', // 記号付き半角カタカナ
      'ｱ) ﾔﾏﾀﾞﾀﾛｳ' // 記号付き半角カタカナ
    ];
    
    for (const name of testNames) {
      const converted = convertToHalfWidthKatakana(name);
      Logger.log(`元: "${name}" → 変換後: "${converted}"`);
    }
    
    Logger.log('\n=== 個別文字テスト ===');
    const individualTests = ['ニ', 'ホ', 'ン', 'サ', 'ン', 'プ', 'ル'];
    for (const char of individualTests) {
      const converted = convertToHalfWidthKatakana(char);
      Logger.log(`"${char}" → "${converted}"`);
    }
    
  } catch (error) {
    Logger.log('半角カタカナ変換テストエラー: ' + error.toString());
  }
}

/**
 * フォルダ内容の確認用関数
 */
function checkFolderContent() {
  try {
    Logger.log('=== フォルダ内容確認 ===');
    diagnoseFolder(UNPROCESSED_FOLDER_ID);
    
    const files = getFilesInFolder(UNPROCESSED_FOLDER_ID);
    if (files && files.length > 0) {
      Logger.log('\n各ファイルの詳細:');
      files.forEach((file, index) => {
        Logger.log('\n--- ファイル ' + (index + 1) + ' ---');
        Logger.log('ファイル名: ' + file.getName());
        Logger.log('ファイルサイズ: ' + file.getSize() + ' bytes');
        Logger.log('MIMEタイプ: ' + file.getMimeType());
        Logger.log('作成日: ' + file.getDateCreated());
        
        // ファイル内容の最初の部分を表示
        try {
          const content = getFileContentFromFile(file);
          if (content && content.length > 0) {
            Logger.log('内容（最初の200文字）: ' + content.substring(0, 200));
          } else {
            Logger.log('内容: 空または読み取り不可');
          }
        } catch (contentError) {
          Logger.log('内容読み取りエラー: ' + contentError.toString());
        }
      });
    } else {
      Logger.log('フォルダ内にファイルが見つかりません');
    }
  } catch (error) {
    Logger.log('フォルダ確認エラー: ' + error.toString());
  }
}

