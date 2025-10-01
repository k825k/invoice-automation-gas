// ================================================================
// 設定ファイルの例 (config.example.js)
// 実際の使用時は config.js としてコピーして使用してください
// ================================================================

// Google Cloud Platform設定
const GCP_PROJECT_NUMBER = 'your_project_number_here';

// Google Drive フォルダID
const UNPROCESSED_FOLDER_ID = 'your_unprocessed_folder_id_here';
const PROCESSED_FOLDER_ID = 'your_processed_folder_id_here';
const CSV_FOLDER_ID = 'your_csv_folder_id_here';

// Slack設定
const SLACK_BOT_TOKEN = 'your_slack_bot_token_here';
const SLACK_CHANNEL_ID = 'your_slack_channel_id_here';

// Gmail設定
const GMAIL_SEARCH_QUERY = 'subject:(請求書添付) has:attachment -label:(処理済)';
const GMAIL_LABEL_NAME = '処理済';

// その他の設定
const DATE_PREFIX_FORMAT = 'yyyy-MM-dd_';

// 設定をエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GCP_PROJECT_NUMBER,
    UNPROCESSED_FOLDER_ID,
    PROCESSED_FOLDER_ID,
    CSV_FOLDER_ID,
    SLACK_BOT_TOKEN,
    SLACK_CHANNEL_ID,
    GMAIL_SEARCH_QUERY,
    GMAIL_LABEL_NAME,
    DATE_PREFIX_FORMAT
  };
}
