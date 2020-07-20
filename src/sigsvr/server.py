import json
import logging
import os.path
from secrets import token_urlsafe
from tornado.ioloop import IOLoop
from tornado.web import RequestHandler, Application
from tornado.websocket import WebSocketHandler


logging.basicConfig( level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler("sigsvr.log"), logging.StreamHandler( )])


class MainHandler( RequestHandler):
    def get( self):
        fname = self.request.uri.split('/')[-1] or 'index.html'
        logging.info( 'MainHandler.get: fname(%s) uri(%s)' % ( fname, self.request.uri))
        self.render( fname)


class SigPubSocketHandler( WebSocketHandler):
    session_cache = dict( )

    def __init__(self, app, req, **kwargs):
        super( SigPubSocketHandler, self).__init__( app, req, **kwargs)
        self.track = dict( )
        self.ice_candidates = []
        self.session_key = token_urlsafe( 32)
        self.__class__.session_cache[self.session_key] = self

    def open( self):
        # The new publishing client has opened a websock. Let it know its session_key
        logging.info( 'SigPubSocketHandler.open: session_key:%s' % self.session_key)
        self.write_message( json.dumps( dict( type='session', key=self.session_key)))

    def on_message(self, msg):
        logging.info( 'SigPubSocketHandler.on_message: %s' % msg)
        dmsg = json.loads( msg)
        mtype = dmsg.get('type')
        if mtype in ['sub_response', 'ice']:
            # 1. Publisher client has recved an offer to connect from a subscriber, and sent
            # an answer in response, which we must relay back to the subscriber.
            # 2. Publisher client has sent an ICE candidate: relay it to the relevant subscriber
            sub_session_key = dmsg.get('sub_session_key')
            SigSubSocketHandler.send_to_subscriber( sub_session_key, dmsg)
        else:
            logging.error( 'SigPubSocketHandler.on_message: bad mtype(%s)' % mtype)

    def on_close(self):
        del self.__class__.session_cache[self.session_key]

    @classmethod
    def send_to_publisher( cls, session_key, dmsg):
        ws = cls.session_cache.get( session_key)
        if ws:
            ws.write_message( json.dumps( dmsg))
        else:
            logging.error('SigPubSocketHandler.send_to_publisher: bad session_key(%s)' % session_key)


class SigSubSocketHandler(WebSocketHandler):
    session_cache = dict( )

    def __init__(self, app, req, **kwargs):
        super( SigSubSocketHandler, self).__init__( app, req, **kwargs)
        self.sub_session_key = token_urlsafe( 32)
        self.__class__.session_cache[self.sub_session_key] = self
        self.pub_session_key = None
        self.ice_candidates = []

    def open( self):
        logging.info( 'SigSubSocketHandler.open')

    def on_message(self, msg):
        logging.info( 'SigSubSocketHandler.on_message: %s' % msg)
        dmsg = json.loads( msg)
        mtype = dmsg.get('type')
        if mtype in ['sub_request', 'sub_answer', 'ice', 'sub_close']:
            # 1. Subscriber client has produced an offer to connect, which will include
            # the publisher session key. Relay to the publisher client.
            # 2. ice: relay ice from subscriber to publisher
            # 3. subscriber client has dropped the connection; relay to publisher so it
            #    can clear it's end of the P2P connection.
            self.pub_session_key = dmsg.get('pub_session_key')
            dmsg['sub_session_key'] = self.sub_session_key
            SigPubSocketHandler.send_to_publisher( self.pub_session_key, dmsg)
        else:
            logging.error( 'SigSubSocketHandler.on_message: bad mtype(%s)' % mtype)

    @classmethod
    def send_to_subscriber( cls, session_key, dmsg):
        ws = cls.session_cache.get( session_key)
        if ws:
            ws.write_message( json.dumps( dmsg))
        else:
            logging.error('SigSubSocketHandler.send_to_subscriber: bad session_key(%s)' % session_key)


class SignalApp( Application):
    def __init__(self, handlers, settings):
        super( ).__init__( handlers, **settings)
        self.session_cache = dict( )


ROOT_DIR = os.path.realpath( os.path.join( os.path.dirname(__file__), '../..'))
HTML_PATH = os.path.join( ROOT_DIR, 'html')
HANDLERS = [
    (r"/ws/pub", SigPubSocketHandler),
    (r"/ws/sub", SigSubSocketHandler),
    (r"/.*\.html", MainHandler),    # top level *.html refs
    (r"/", MainHandler),
]
SETTINGS = dict(
    template_path=HTML_PATH,
    # XSRF: http://technobeans.wordpress.com/2012/08/31/tornado-xsrf/
    xsrf_cookies=False,  # add XSRF later if it becomes corporate requirement
    debug=True,
)
PORT = 8090


if __name__ == "__main__":
    app = SignalApp( HANDLERS, SETTINGS)
    app.listen( PORT)
    IOLoop.instance( ).start( )