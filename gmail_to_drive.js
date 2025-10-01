// ================================================================
// ▼▼▼【重要】ここから設定項目 ▼▼▼
// ================================================================

// 1. 検索したいメールの条件を指定します。
// ★★★★★ 修正点 ★★★★★
// 「-label:(処理済)」を追加して、処理済のメールを対象外にします。
const SEARCH_QUERY = PropertiesService.getScriptProperties().getProperty('GMAIL_SEARCH_QUERY') || 'subject:(請求書添付) has:attachment -label:(処理済)';

// 2. 保存先となるGoogleドライブのフォルダIDを指定します。
// 注意: 実際の使用時は Google Apps Script のプロパティサービスで設定してください
const FOLDER_ID = PropertiesService.getScriptProperties().getProperty('UNPROCESSED_FOLDER_ID') || 'your_unprocessed_folder_id_here';

// 3. ファイル名の先頭に付ける日付の形式を指定します。
const DATE_PREFIX_FORMAT = 'yyyy-MM-dd_';

// 4. 処理後に付けるラベルの名前を指定します。
const LABEL_NAME = PropertiesService.getScriptProperties().getProperty('GMAIL_LABEL_NAME') || '処理済';


// ================================================================
// ▲▲▲【重要】ここまで設定項目 ▲▲▲
// ================================================================

/**
 * メインの処理を実行する関数
 */
function saveAttachmentsToDrive() {
  // 処理後に付けるラベルを取得、なければ作成する
  let label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) {
    label = GmailApp.createLabel(LABEL_NAME);
    console.log(`ラベル「${LABEL_NAME}」を新規作成しました。`);
  }

  // 指定した条件でGmailのスレッドを検索
  const threads = GmailApp.search(SEARCH_QUERY);

  // 検索結果が0件の場合は何もしない
  if (threads.length === 0) {
    console.log('対象のメールが見つかりませんでした。');
    return;
  }

  // 保存先のフォルダを取得
  const folder = DriveApp.getFolderById(FOLDER_ID);

  // 見つかったスレッド（メールのやり取り）を一つずつ処理
  for (const thread of threads) {
    const messages = thread.getMessages(); // スレッド内の全メールを取得

    // メールを一つずつ処理
    for (const message of messages) {
      // 添付ファイルを取得
      const attachments = message.getAttachments();

      // 添付ファイルを一つずつ処理
      for (const attachment of attachments) {
        // ファイル名の重複を避けるために日付を先頭に付与
        const datePrefix = Utilities.formatDate(new Date(), 'JST', DATE_PREFIX_FORMAT);
        const fileName = datePrefix + attachment.getName();

        // ファイルをドライブに保存
        folder.createFile(attachment.copyBlob()).setName(fileName);
        console.log(`ファイル「${fileName}」を保存しました。`);
      }
    }
    
    // スレッド内のすべての添付ファイルを保存し終わったら、「処理済」ラベルを付ける
    thread.addLabel(label);
    console.log(`スレッド「${thread.getFirstMessageSubject()}」にラベル「${LABEL_NAME}」を付けました。`);
  }
}


