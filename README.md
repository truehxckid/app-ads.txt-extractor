# App-Ads.txt Extractor

Extract developer domains and analyze app-ads.txt files from app bundle IDs across multiple app stores.

## Features

- **Multi-Store Support**: Extract domains from Google Play, App Store, Amazon, Roku, and Samsung
- **Batch Processing**: Process multiple app bundle IDs simultaneously
- **app-ads.txt Analysis**: Check for and analyze app-ads.txt files automatically
- **Multi-Term Search**: Search for multiple terms within app-ads.txt files with highlighted results
- **Performance Optimized**: Caching system with Redis support for faster results
- **Rate Limiting**: Intelligent rate limiting to prevent IP blocking
- **Dark Mode**: Toggle between light and dark themes
- **CSV Export**: Download results as CSV for further analysis
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm
- Redis (optional, for enhanced caching and rate limiting)

### Installation

1. Clone the repository
   ```
   git clone https://github.com/truehxckid/app-ads.txt-extractor.git
   cd app-ads.txt-extractor
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file with the following configuration:
   ```
   PORT=3000
   NODE_ENV=development
   REDIS_URL=redis://localhost:6379  # Optional
   ```

4. Start the server
   ```
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

### Finding Developer Domains

1. Enter bundle IDs in the text area (one per line) or upload a CSV file
2. (Optional) Add search terms to look for in app-ads.txt files
3. Click "Extract All Developer Domains"
4. View results in the table, with options to:
   - View app-ads.txt content
   - View search matches with color-coded highlighting
   - Copy domains
   - Download results as CSV

### Bundle ID Formats

The tool automatically detects the app store based on the bundle ID format:

- **Google Play**: Package name format with at least one dot (e.g., `tv.fubo.mobile`)
- **App Store**: Numeric ID (8-12 digits) with optional 'id' prefix (e.g., `id389801252` or `389801252`)
- **Amazon**: ASIN format starting with 'B' followed by 9-10 alphanumeric characters (e.g., `B019DCHDZK`)
- **Roku**: Several formats are supported:
  - Short numeric IDs (4-6 digits, e.g., `41468`)
  - UUID-like format (e.g., `a1b2c3d4e5f6g7h8i9j0:1a2b3c4d5e6f7g8h9i0j`)
  - Other alphanumeric formats without dots
- **Samsung**: Galaxy Store ID starting with 'G' followed by 8-15 digits (e.g., `G19068012619`)

### Searching app-ads.txt Files

- Add one or more search terms to find specific content in app-ads.txt files
- Search is case-insensitive and matches partial strings
- Results show color-coded highlights for each search term
- View individual matches for each term in the detailed results

## Performance Considerations

- The tool implements a sophisticated caching system for both stores and app-ads.txt files
- Rate limiting is applied to prevent IP blocking by app stores
- Processing is done in batches to manage memory usage and improve performance
- Large app-ads.txt files are truncated in the UI for better display performance
- Memory management is optimized with Node.js garbage collection

## Browser Support

The application is optimized for:
- Chrome 90+
- Firefox 90+
- Safari 14+
- Edge 90+

## Troubleshooting

### Common Issues

- **Multiple Search Terms Appearing**: If you experience issues with multiple search term inputs appearing when clicking "Add Search Term", please update to the latest version which fixes this issue.

- **Nginx Configuration**: When setting up Nginx, ensure you use the correct path `/etc/nginx/` (not "ngnix") in your configuration commands.

- **Search or Extract Not Working**: Make sure to check the console for any errors. The application includes debug mode which you can activate by pressing Ctrl+D.

## Development

### Running in Development Mode

```
npm run dev
```

### Testing and Linting

```
npm run test
npm run lint
```

### Project Structure

```
app-ads.txt-extractor/
├── server.js                  # Main server file
├── src/                       # Server-side source code
│   ├── app.js                 # Express application setup
│   ├── config/                # Configuration files
│   ├── core/                  # Core business logic
│   ├── middleware/            # Express middleware
│   ├── routes/                # API routes
│   ├── services/              # Services and utilities
│   ├── utils/                 # Utility functions
│   └── workers/               # Worker thread implementations
├── public/                    # Client-side assets
│   ├── index.html             # Main HTML file
│   ├── js/                    # JavaScript modules
│   │   ├── main.js            # Main client entry point
│   │   ├── modules/           # Feature modules
│   │   ├── utils/             # Client utilities
│   │   └── workers/           # Client-side workers
│   ├── styles.css             # CSS styles
│   └── validation.js          # Form validation
├── cache/                     # Cache directory
└── logs/                      # Application logs
```

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Thanks to all the app stores for providing developer information
- Built with Express.js, Axios, and Cheerio
- Optimized with modern JavaScript features