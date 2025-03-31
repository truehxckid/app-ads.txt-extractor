# App Developer Domain Extractor

Extract developer domains from app bundle IDs across multiple app stores with enhanced app-ads.txt analysis.

![App Developer Domain Extractor](docs/preview.png)

## Features

- **Multi-Store Support**: Extract domains from Google Play, App Store, Amazon, and Roku
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

- Node.js 18.x or higher
- npm or yarn
- Redis (optional, for enhanced caching and rate limiting)

### Installation

1. Clone the repository
   ```
   git clone https://github.com/yourusername/app-developer-domain-extractor.git
   cd app-developer-domain-extractor
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Start the server
   ```
   npm start
   ```

4. Open your browser and navigate to `http://localhost:3000`

### Environment Variables

- `PORT`: Port to run the server on (default: 3000)
- `REDIS_URL`: Redis connection URL (optional)
- `NODE_ENV`: Set to 'production' for production environment

## Usage

### Finding Developer Domains

1. Enter bundle IDs in the text area (one per line) or upload a CSV file
2. (Optional) Add search terms to look for in app-ads.txt files
3. Click "Extract All Developer Domains"
4. View results in the table, with options to:
   - View app-ads.txt content
   - View search matches
   - Copy domains
   - Download results as CSV

### Bundle ID Formats

The tool automatically detects the app store based on the bundle ID format:

- **Google Play**: Package name (e.g., `com.instagram.android`)
- **App Store**: Numeric ID with/without 'id' prefix (e.g., `id389801252` or `389801252`)
- **Amazon**: ASIN format (e.g., `B019DCHDZK`)
- **Roku**: Simple ID (e.g., `41468`) or complex ID

### Searching app-ads.txt Files

- Add one or more search terms to find specific content in app-ads.txt files
- Search is case-insensitive and matches partial strings
- Results show color-coded highlights for each search term
- View individual matches for each term in the detailed results

## API Reference

The application provides a REST API for integration with other systems.

### Endpoint: `/api/extract-multiple`

**Method**: POST

**Request Body**:
```json
{
  "bundleIds": ["com.example.app1", "com.example.app2"],
  "searchTerms": ["google.com", "direct"]
}
```

**Response**:
```json
{
  "results": [...],
  "errorCount": 0,
  "totalProcessed": 2,
  "appsWithAppAdsTxt": 1,
  "searchStats": {...},
  "domainAnalysis": {...},
  "cacheStats": {...},
  "success": true,
  "processingTime": "1234ms"
}
```

See the [API Documentation](docs/api.md) for more details.

## Performance Considerations

- The tool implements a sophisticated caching system for both stores and app-ads.txt files
- Rate limiting is applied to prevent IP blocking by app stores
- Processing is done in batches to manage memory usage and improve performance
- Large app-ads.txt files are truncated in the UI for better display performance

## Development

### Running in Development Mode

```
npm run dev
```

### Running Tests

```
npm test
```

### Building for Production

```
npm run build
```

## Contributing

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