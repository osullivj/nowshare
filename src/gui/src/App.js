import React from 'react';
import {Switch,Route} from 'react-router-dom';
import './App.css';


class Sender extends React.Component {
    constructor( props) {
        super( props);
        this.state = {
            peers:{},
            local_stream:null,
            ice_candidates:{},
            pub_session_key:'',
            web_socket:null,
            rtc_config:{}
        };
        this.start = this.start.bind( this);
    }

    async new_subscriber( sub_session_key) {
        var pc = new RTCPeerConnection( this.state.rtc_config);
        this.state.local_stream.getTracks( ).forEach( track => {
            console.log('add local track ' + track.kind + ' to peer connection.');
            console.log(track);
            pc.addTrack( track, this.state.local_stream);
        });
        pc.addEventListener("icegatheringstatechange", (ev) => {
            console.log('icegatheringstatechange state:' + ev.target.iceGatheringState);
            console.log( ev);
        }, false);
        pc.addEventListener("icecandidate", (ev) => {
            if (ev.candidate != null) {
                console.log('icecandidate: ' + ev.candidate);
                this.state.web_socket.send(JSON.stringify({
                        'type': 'ice',
                        'candidate': ev.candidate.candidate,
                        'sdpMLineindex': ev.candidate.sdpMLineIndex,
                        'sdpMid': ev.candidate.sdpMid,
						'sub_session_key':sub_session_key,
						'pub_session_key':this.state.pub_session_key
                }));
            }
        }, false);
		return pc;
    }

    async start( ) {
        const remoteVideo = this.refs.videoCtl;
        const mediaConstraints = { 'video': true, 'audio': false};
        this.state.local_stream = await navigator.mediaDevices.getDisplayMedia(mediaConstraints);
        remoteVideo.srcObject = this.state.local_stream;
        // Create web socket, and add .state member so web sock event handlers can reach React state.
        this.state.web_socket = new WebSocket(this.props.web_socket_url);
        this.state.web_socket.parent = this;
        this.state.web_socket.onmessage = async function (evt) {
            console.log("websocket recv: " + evt.data);
            let obj = JSON.parse(evt.data);
            if (obj['type'] === 'ice') {
		        let sub_session_key = obj['sub_session_key'];
				let pc = this.parent.state.peers[sub_session_key];
                console.log("remote ice candidate: " + obj['candidate']);
				if ( pc.remoteDescription == null) {
					if ( sub_session_key in this.parent.state.ice_candidates) {
						let candidates = this.parent.state.ice_candidates[sub_session_key];
						candidates.push( obj);
					}
					else {
					    var new_candidate = {};
					    new_candidate[sub_session_key] = [obj];
						this.parent.setState({ice_candidates:{...this.parent.state.ice_candidates, ...new_candidate}});
					}
				}
				else {
					pc.addIceCandidate({ candidate: obj['candidate'], sdpMid: obj['sdpMid'], sdpMLineIndex:obj['sdpMLineIndex'] });
				}
            }
			else if (obj['type'] === 'session') {
				this.parent.setState( {pub_session_key:obj['key']});
				console.log("new_publisher.session_key:" + this.parent.state.pub_session_key);
				// $("#sessionkey").text( this.state.pub_session_key);
			}
			else if (obj['type'] === 'sub_request') {
				let sub_session_key = obj['sub_session_key'];
				let pc = await this.parent.new_subscriber( sub_session_key);
				let offer = await pc.createOffer( );
				await pc.setLocalDescription( offer);
				this.send( JSON.stringify( { 'type': 'sub_response', 'sdp': offer.sdp,
											'sub_session_key': sub_session_key}));
				var new_peer = {};
				new_peer[sub_session_key] = pc;
				this.parent.setState({peers:{...this.parent.state.peers, ...new_peer}});
				// this.state.peers[sub_session_key] = pc;
			}
			else if (obj['type'] === 'sub_answer') {
				let sub_session_key = obj['sub_session_key'];
				let pc = this.parent.state.peers[sub_session_key];
				await pc.setRemoteDescription( { type:'answer', sdp:obj.sdp});
			}
			else if (obj['type'] === 'sub_close') {
				let sub_session_key = obj['sub_session_key'];
				let peers = this.parent.state.peers;
				let pc = peers[sub_session_key];
				pc.close( );
				delete peers[sub_session_key];
				this.parent.setState( {peers:peers})
			}
            else {
                console.log( "UNEXPECTED type:" + obj['type']);
            }
        };
    }

    async close() {
    }

    render() {
        return (
            <div className="container">
                <div className="jumbotron">
    				<video controls autoPlay="autoplay" ref="videoCtl" width="640" height="480"></video>
    			</div>
    			<div>
    			    <div className="form-group">
                        <button className="btn btn-lg btn-success" onClick={this.start}>Start</button>
                        <button className="btn btn-lg btn-danger" onClick={this.close}>Stop</button>
                    </div>
                    <div className="form-group">
                        <label>Session</label>
        		        <textarea className="form-control" readOnly value={this.state.pub_session_key} rows="1" cols="50"></textarea>
        		    </div>
        		</div>
            </div>
        );
    }
}

class Receiver extends React.Component {
    constructor( props) {
        super( props);
        this.state = {
            peer:null,
            local_stream:null,
            ice_candidates:{},
            pub_session_key:'',
            web_socket:null,
            rtc_config:{}
        };
        this.start = this.start.bind( this);
        this.closePeer = this.closePeer.bind( this);
        this.handleChange = this.handleChange.bind( this);
    }

    async start() {
        this.closePeer();
        const remoteVideo = this.refs.videoCtl;
	    this.state.peer = new RTCPeerConnection( this.state.rtc_config);
		this.state.peer.ontrack = function( ev) {
			console.log( 'ontrack: ' + ev);
			remoteVideo.srcObject = ev.streams[0];
		};

        this.state.web_socket = new WebSocket(this.props.web_socket_url);
        this.state.web_socket.state = this.state;

        this.state.peer.addEventListener("icegatheringstatechange", (ev) => {
            console.log('icegatheringstatechange state: ' + ev.target.iceGatheringState);
            console.log(ev);
        }, false);

        this.state.peer.addEventListener("icecandidate", (ev) => {
            if (ev.candidate != null) {
                console.log( 'icecandidate: ' + ev.candidate);
                this.state.web_socket.send(JSON.stringify({
                    'type': 'ice',
                    'candidate': ev.candidate.candidate,
                    'sdpMLineindex': ev.candidate.sdpMLineIndex,
                    'sdpMid': ev.candidate.sdpMid,
		    		'pub_session_key':this.state.pub_session_key
                }));
            }
        }, false);

        this.state.web_socket.onmessage = async function (evt) {
            console.log("websocket recv: " + evt.data);
            let obj = JSON.parse(evt.data);
            if (obj['type'] === 'ice') {
                console.log("remote ice candidate: " + obj['candidate']);
                this.state.peer.addIceCandidate({ candidate: obj['candidate'], sdpMid: obj['sdpMid'],
													sdpMLineIndex:obj['sdpMLineIndex'] });
            }
            else if (obj['type'] === 'sub_response') {
		    	let offer = obj['sdp'];
                console.log("sub_response.offer: " + offer);
                await this.state.peer.setRemoteDescription(new RTCSessionDescription( {type:'offer',sdp:offer}));
				let answer = await this.state.peer.createAnswer( );
				await this.state.peer.setLocalDescription( answer);
				this.state.web_socket.send( JSON.stringify( {
				    type: 'sub_answer',
				    pub_session_key: this.state.pub_session_key,
				    sdp:answer.sdp
				}));
			}
        };

        this.state.web_socket.onopen = async function () {
            this.state.web_socket.send(JSON.stringify({
                type: 'sub_request',
                pub_session_key: this.state.pub_session_key})
            );
        };
    }

    closePeer() {
        console.log("close peer");
	    if ( this.state.web_socket != null) {
		    this.state.web_socket.send(JSON.stringify({
		        'type': 'sub_close', 'pub_session_key': this.state.pub_session_key}));
			this.state.web_socket.close( );
		}
        if ( this.state.peer != null) {
            this.state.peer.close();
        }
    }

    handleChange( ev) {
        this.setState({pub_session_key:ev.target.value});
    }

    render() {
        return (
            <div className="container">
                <div className="jumbotron">
    				<video controls autoPlay="autoplay" ref="videoCtl" width="640" height="480"></video>
    			</div>
    			<div>
    			    <div className="form-group">
                        <button className="btn btn-lg btn-success" onClick={this.start}>Start</button>
                        <button className="btn btn-lg btn-danger" onClick={this.close}>Stop</button>
                        <button className="btn btn-lg btn-info" onClick={this.clearSessionKey}>Clear</button>
                    </div>
                    <div className="form-group">
                        <label>Session</label>
        		        <textarea value={this.state.pub_session_key} onChange={this.handleChange} rows="1" cols="50"></textarea>
        		    </div>
        		</div>
            </div>
        );
    }
}

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <Switch>
            <Route exact path='/sendr'>
                <Sender web_socket_url='ws://localhost:8090/ws/pub'/>
            </Route>
            <Route exact path='/recvr'>
                <Receiver web_socket_url='ws://localhost:8090/ws/sub'/>
            </Route>
        </Switch>
      </header>
    </div>
  );
}

export default App;
