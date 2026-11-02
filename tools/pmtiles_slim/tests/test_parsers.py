"""Every protobuf parser in the tool must advance or stop with an error on group wire types (3/4), unknown wire types,
truncated fields and truncated varints. Each case runs in a subprocess with a timeout, so a hang fails the test."""
import os,subprocess,sys,unittest,textwrap
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')
def tag(f,w):return bytes([(f<<3)|w])
def ldf(f,b):return tag(f,2)+bytes([len(b)])+b
GROUP=tag(9,3)+tag(9,4)          # start-group + end-group for field 9
NAME=ldf(1,b'roads')
def run(code,timeout=10):
    src="import sys;sys.path.insert(0,%r)\nfrom pm import *\nimport ana,kinds,slim\nVSRC=open('verify.py').read();exec('from pm import vi,skip,ld\\n'+VSRC[VSRC.index('def split'):VSRC.index('def layers')])\n"%D+textwrap.dedent(code)
    try:
        r=subprocess.run([sys.executable,'-c',src],cwd=D,capture_output=True,text=True,timeout=timeout)
    except subprocess.TimeoutExpired:
        return 'HANG'
    return 'ok' if r.returncode==0 else ('ValueError' if 'ValueError' in r.stderr else r.stderr[-300:])
CASES={  # name -> bytes of one malformed unit
  'group':GROUP,'unknown_wt6':tag(9,6),'trunc_fixed32':tag(9,5)+b'\x00','trunc_fixed64':tag(9,1)+b'\x00\x00',
  'trunc_len':tag(9,2)+b'\x7f'+b'\x00','trunc_varint':tag(9,0)+b'\x80'}
class Parsers(unittest.TestCase):
    def check(self,code_tpl):
        bad=[]
        for n,b in CASES.items():
            r=run(code_tpl.replace('@@',repr(b)))
            if r not in('ValueError',):bad.append((n,r))
        self.assertEqual(bad,[],'every malformed field must raise ValueError (no hang, no silent skip)')
    def test_ana_parse_value(self):self.check("ana.parse_value(@@)")
    def test_ana_feat(self):self.check("ana.feat(@@)")
    def test_ana_parse_layer(self):self.check("ana.parse_layer(%r+@@)"%NAME)
    def test_kinds_parse_layer(self):self.check("kinds.parse_layer(%r+@@)"%NAME)
    def test_kinds_value_nested(self):self.check("kinds.parse_layer(%r+bytes([0x22,len(@@)])+@@)"%NAME)
    def test_kinds_feat_tags(self):self.check("kinds.feat_tags(@@)")
    def test_kinds_tile_layers(self):self.check("kinds.tile_layers(@@)")
    def test_slim_tile(self):self.check("slim.slim_tile(@@,5)")
    def test_slim_layer_level(self):self.check("slim.slim_tile(bytes([0x1a,len(%r+@@)])+%r+@@,5)"%(NAME,NAME))
    def test_verify_split(self):self.check("split(@@)")
    def test_skip_directly(self):self.check("skip(@@[1:],0,@@[0]&7)")
    def test_wellformed_unaffected(self):
        self.assertEqual(run("assert skip(b'\\x05abcde',0,2)==6;assert ld(b'\\x02hi',0)==(b'hi',3);assert skip(b'\\x01',0,0)==1;assert skip(b'1234',0,5)==4"),'ok')
    def test_group_unknown_fields_loud_for_vi(self):
        self.assertEqual(run("vi(b'\\xff'*11+b'\\x01',0)"),'ValueError')   # overlong varint
if __name__=='__main__':unittest.main()
