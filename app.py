import os
from flask import Flask, request, redirect, url_for, render_template, jsonify, make_response
from spotipy import Spotify
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
import time

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY', os.urandom(24))


client_id = os.getenv('SPOTIPY_CLIENT_ID')
client_secret = os.getenv('SPOTIPY_CLIENT_SECRET')
redirect_uri = os.getenv('SPOTIPY_REDIRECT_URI')
scope = os.getenv('SPOTIPY_SCOPE')

REFRESH_TOKEN_COOKIE_NAME = 'spotify_refresh_token'

def create_spotify_oauth():
    return SpotifyOAuth(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scope=scope,
        show_dialog=True
    )

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/login')
def login():
    sp_oauth = create_spotify_oauth()
    auth_url = sp_oauth.get_authorize_url()
    return redirect(auth_url)

@app.route('/callback')
def callback():
    sp_oauth = create_spotify_oauth()
    code = request.args.get('code')

    token_info = sp_oauth.get_access_token(code)

    response = make_response(redirect(url_for('index')))
    
    if token_info.get('refresh_token'):
        response.set_cookie(
            REFRESH_TOKEN_COOKIE_NAME, 
            token_info['refresh_token'], 
            httponly=True, 
            secure=True,
            samesite='Lax',
            max_age=30 * 24 * 60 * 60 
        )
    return response

@app.route('/api/refresh-token', methods=['POST'])
def refresh_token():
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)
    if not refresh_token:
        return jsonify({"error": "No refresh token found"}), 401

    sp_oauth = create_spotify_oauth()
    try:
        new_token_info = sp_oauth.refresh_access_token(refresh_token)
        return jsonify({
            'access_token': new_token_info['access_token'],
            'expires_at': new_token_info['expires_at']
        })
    except Exception as e:
        response = make_response(jsonify({"error": "Invalid refresh token", "details": str(e)}), 401)
        response.delete_cookie(REFRESH_TOKEN_COOKIE_NAME)
        return response

def get_spotify_client():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None, (jsonify({"error": "Authorization header is missing or invalid"}), 401)
    
    access_token = auth_header.split(" ")[1]
    sp = Spotify(auth=access_token)
    return sp, None

@app.route('/api/dashboard-data')
def api_dashboard_data():
    sp, error = get_spotify_client()
    if error:
        return error

    time_range = request.args.get('time_range', 'long_term')

    try:
        top_tracks = sp.current_user_top_tracks(limit=20, time_range=time_range)
        top_artists = sp.current_user_top_artists(limit=20, time_range=time_range)
        user_profile = sp.current_user()

        tracks = [{
            'name': item['name'],
            'artist': ', '.join([a['name'] for a in item['artists']]),
            'url': item['external_urls']['spotify'],
        } for item in top_tracks['items']]

        artists = [{
            'name': item['name'],
            'url': item['external_urls']['spotify'],
        } for item in top_artists['items']]

        return jsonify({
            "user": {
                "display_name": user_profile.get('display_name', 'Użytkownik'),
            },
            "top_tracks": tracks,
            "top_artists": artists
        })
    except Exception as e:
        if 'token expired' in str(e).lower():
            return jsonify({"error": "Token expired"}), 401
        return jsonify({"error": str(e)}), 500

@app.route('/api/logout', methods=['POST'])
def api_logout():
    response = make_response(jsonify({'status': 'logged_out'}))
    response.delete_cookie(REFRESH_TOKEN_COOKIE_NAME)
    return response

if __name__ == "__main__":
    app.run(debug=True, port=5000)