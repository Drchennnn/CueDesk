from pathlib import Path

def elements(s,start):
 depth=0;quote=None;comment=None;begin=start;out=[];i=start
 while i<len(s):
  c=s[i];n=s[i:i+2]
  if comment:
   if comment=='line' and c=='\n':comment=None
   elif comment=='block' and n=='*/':comment=None;i+=1
  elif quote:
   if c=='\\':i+=1
   elif c==quote:quote=None
  elif n=='//':comment='line';i+=1
  elif n=='/*':comment='block';i+=1
  elif c in "\"'`":quote=c
  elif c in '([{':depth+=1
  elif c in ')]}':
   if c==']' and depth==0:
    if s[begin:i].strip():out.append(s[begin:i].strip())
    return out,i
   depth-=1
  elif c==',' and depth==0:out.append(s[begin:i].strip());begin=i+1
  i+=1
 raise ValueError('unterminated')
if __name__=='__main__':
 r=Path('work/settings-layout/renderer.mjs').read_text('utf8');p=r.index('function SettingsPanel(');start=r.index('className: "settings", children: [',p)+len('className: "settings", children: [');items,end=elements(r,start)
 for i,x in enumerate(items):print(i,x[:155].replace('\n',' '))
 for x in items:
  if 'className: "settings-advanced"' in x:
   print('ADVANCED');inner,_=elements(x,x.index('children: [')+len('children: ['))
   for i,y in enumerate(inner):print(i,y[:135].replace('\n',' '))
