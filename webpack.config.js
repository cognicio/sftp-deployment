const path = require('path');
const webpack = require('webpack');

module.exports = {
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs'
  },
  devtool: 'source-map',
  optimization: {
    minimize: false
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader' }]
      }
    ]
  },
  plugins: [
    // Ignore both the native binaries (.node) and the cpu-features module inside ssh2
    new webpack.IgnorePlugin({
      resourceRegExp: /\.node$/,
      contextRegExp: /ssh2/
    }),
    new webpack.IgnorePlugin({
      resourceRegExp: /^cpu-features$/
    })
  ],
  externals: {
    vscode: 'commonjs vscode'
  }
};